import { Room, Client } from '@colyseus/core';
import { RealmRoomState } from '../schema/RealmRoomState.js';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import { EnemyAI } from '../systems/EnemyAI.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { initSanctuaries, tickSanctuaries } from '../systems/SanctuarySystem.js';
import { validateSupabaseToken } from '../auth/validateToken.js';
import { persistMatchResult, incrementPlayerStats, updateCharacterXp } from '../db/supabase.js';
import { CLASS_DEFINITIONS, CHAT_MAX_LENGTH, ALIAS_MAX_LENGTH, TICK_MS, ENERGY_REGEN_PER_TICK } from '@fmr/shared';
import { sanitizeAlias, clamp, generateRoomCode } from '@fmr/shared';
import { MSG } from '@fmr/shared';
import type { PlayerClass, PlayerInputPayload } from '@fmr/shared';

export interface RealmJoinOptions {
  alias?: string;
  classKey?: PlayerClass;
  authToken?: string;
  guestId?: string;
  isPrivate?: boolean;
  roomCode?: string;
}

export class RealmRoom extends Room<{ state: RealmRoomState }> {
  maxClients = 6;
  private enemyAI = new EnemyAI();
  private combat = new CombatSystem();
  private xpAccumulated: Map<string, number> = new Map();
  private playerUserIds: Map<string, string | null> = new Map();
  private startedAt = new Date();
  private roomCode = generateRoomCode();
  private inputQueue: Map<string, PlayerInputPayload[]> = new Map();

  onCreate(options: RealmJoinOptions) {
    this.setState(new RealmRoomState());
    this.enemyAI.initEnemies(this.state.enemies);
    initSanctuaries(this.state.sanctuaries);

    this.setMetadata({
      mode: 'realm',
      roomCode: this.roomCode,
      isPrivate: options.isPrivate ?? false,
    });

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), TICK_MS);

    this.onMessage(MSG.PLAYER_INPUT, (client, input: PlayerInputPayload) => {
      const queue = this.inputQueue.get(client.sessionId) ?? [];
      queue.push(input);
      this.inputQueue.set(client.sessionId, queue);
    });

    this.onMessage(MSG.CHAT, (client, payload: { text: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const text = String(payload.text).slice(0, CHAT_MAX_LENGTH);
      this.broadcast(MSG.CHAT_MESSAGE, {
        senderId: client.sessionId,
        alias: player.alias,
        text,
        timestamp: Date.now(),
      });
    });

    this.onMessage(MSG.READY, (client) => {
      console.log(`[RealmRoom] ${client.sessionId} ready`);
    });

    console.log(`[RealmRoom] ${this.roomId} created, code: ${this.roomCode}`);
  }

  async onJoin(client: Client, options: RealmJoinOptions) {
    const alias = sanitizeAlias(options.alias ?? 'Hero', 2, ALIAS_MAX_LENGTH);
    const classKey = (options.classKey as PlayerClass) ?? 'stag_druid';
    const classDef = CLASS_DEFINITIONS[classKey] ?? CLASS_DEFINITIONS.stag_druid;

    let userId: string | null = null;
    let authMode = 'guest';

    if (options.authToken) {
      const validated = await validateSupabaseToken(options.authToken);
      if (validated) {
        userId = validated.userId;
        authMode = 'registered';
      }
    }

    this.playerUserIds.set(client.sessionId, userId);
    this.xpAccumulated.set(client.sessionId, 0);

    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.userId = userId ?? '';
    player.guestId = options.guestId ?? '';
    player.alias = alias;
    player.classKey = classKey;
    player.x = 400 + Math.random() * 800;
    player.y = 400 + Math.random() * 400;
    player.hp = classDef.stats.maxHp;
    player.maxHp = classDef.stats.maxHp;
    player.energy = classDef.stats.maxEnergy;
    player.maxEnergy = classDef.stats.maxEnergy;
    player.moveSpeed = classDef.stats.moveSpeed;
    player.attackDamage = classDef.stats.attackDamage;
    player.attackRange = classDef.stats.attackRange;
    player.authMode = authMode;
    player.teamId = this.state.players.size % 2;
    player.isAlive = true;

    this.state.players.set(client.sessionId, player);

    client.send(MSG.PLAYER_JOINED, {
      playerId: client.sessionId,
      roomCode: this.roomCode,
    });

    console.log(`[RealmRoom] ${alias} (${authMode}) joined`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputQueue.delete(client.sessionId);
    console.log(`[RealmRoom] ${client.sessionId} left`);
  }

  async onDispose() {
    await this.endMatch('disconnect');
  }

  private tick(deltaMs: number) {
    if (!this.state.matchActive) return;
    const now = Date.now();
    this.state.elapsedMs += deltaMs;

    // Process inputs
    this.inputQueue.forEach((queue, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player || !player.isAlive) {
        this.inputQueue.set(sessionId, []);
        return;
      }

      let totalDx = 0;
      let totalDy = 0;
      let latestAimX = player.x;
      let latestAimY = player.y;
      let abilityToUse: string | null = null;

      for (const input of queue) {
        totalDx += input.dx;
        totalDy += input.dy;
        latestAimX = input.aimX;
        latestAimY = input.aimY;
        if (input.abilityKey) abilityToUse = input.abilityKey;
      }
      this.inputQueue.set(sessionId, []);

      // Normalize movement
      const len = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
      if (len > 0) {
        const nx = totalDx / len;
        const ny = totalDy / len;
        const speed = player.moveSpeed;
        const dt = deltaMs / 1000;
        player.x = clamp(player.x + nx * speed * dt, 50, 1550);
        player.y = clamp(player.y + ny * speed * dt, 50, 1150);

        player.direction = Math.abs(nx) > Math.abs(ny)
          ? (nx > 0 ? 'right' : 'left')
          : (ny > 0 ? 'down' : 'up');
        player.animState = 'walk';
      } else if (player.animState === 'walk') {
        player.animState = 'idle';
      }

      // Ability handling
      if (abilityToUse === 'basic') {
        const results = this.combat.applyPlayerAttack(sessionId, latestAimX, latestAimY, this.state.players, this.state.enemies, now);
        results.forEach((r) => {
          this.broadcast(MSG.DAMAGE_EVENT, { targetId: r.targetId, sourceId: sessionId, amount: r.amount, isPlayer: r.isPlayer });
          if (r.killed && !r.isPlayer) {
            this.awardXp(sessionId, 10);
            this.broadcast(MSG.ENEMY_DIED, { enemyId: r.targetId, killerId: sessionId });
          }
        });
      } else if (abilityToUse) {
        const results = this.combat.applyAbility(sessionId, abilityToUse as any, latestAimX, latestAimY, this.state.players, this.state.enemies, now);
        results.forEach((r) => {
          this.broadcast(MSG.DAMAGE_EVENT, { targetId: r.targetId, sourceId: sessionId, amount: r.amount, isPlayer: r.isPlayer });
          if (r.killed && !r.isPlayer) {
            this.awardXp(sessionId, 10);
            this.broadcast(MSG.ENEMY_DIED, { enemyId: r.targetId, killerId: sessionId });
          }
        });
      }

      // Energy regen
      player.energy = clamp(player.energy + ENERGY_REGEN_PER_TICK, 0, player.maxEnergy);
    });

    // Respawn dead players
    this.state.players.forEach((player: PlayerSchema) => {
      if (!player.isAlive) {
        player.respawnTimer -= deltaMs;
        if (player.respawnTimer <= 0) {
          this.respawnPlayer(player);
        }
      }
    });

    // Enemy AI tick
    const enemyDamage = this.enemyAI.tick(this.state.enemies, this.state.players, deltaMs, now);
    enemyDamage.forEach((ev) => {
      this.broadcast(MSG.DAMAGE_EVENT, { targetId: ev.targetId, sourceId: ev.sourceId, amount: ev.amount, isPlayer: true });
    });

    // Sanctuary tick
    tickSanctuaries(this.state.sanctuaries, this.state.players, deltaMs);
  }

  private respawnPlayer(player: PlayerSchema) {
    const classDef = CLASS_DEFINITIONS[player.classKey as PlayerClass];
    player.hp = classDef?.stats.maxHp ?? 100;
    player.energy = classDef?.stats.maxEnergy ?? 100;
    player.x = 400 + Math.random() * 800;
    player.y = 400 + Math.random() * 400;
    player.isAlive = true;
    player.animState = 'idle';
    player.respawnTimer = 0;
    this.broadcast(MSG.PLAYER_RESPAWNED, { playerId: player.id });
  }

  private awardXp(sessionId: string, amount: number) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.xp += amount;
    this.xpAccumulated.set(sessionId, (this.xpAccumulated.get(sessionId) ?? 0) + amount);
    this.clients.find((c) => c.sessionId === sessionId)?.send(MSG.XP_GAINED, { playerId: sessionId, amount, total: player.xp });
  }

  private async endMatch(reason: string) {
    if (!this.state.matchActive) return;
    this.state.matchActive = false;
    const endedAt = new Date();

    const playerSummary: Record<string, { alias: string; xp: number; userId: string | null }> = {};
    this.state.players.forEach((p: PlayerSchema, sid: string) => {
      playerSummary[sid] = {
        alias: p.alias,
        xp: this.xpAccumulated.get(sid) ?? 0,
        userId: this.playerUserIds.get(sid) ?? null,
      };
    });

    await persistMatchResult({
      roomId: this.roomId,
      mode: 'realm',
      winnerUserId: null,
      startedAt: this.startedAt,
      endedAt,
      metadata: { reason, players: playerSummary },
    });

    for (const [sid, info] of Object.entries(playerSummary)) {
      if (!info.userId) continue;
      await incrementPlayerStats(info.userId, {
        games_played: 1,
        monsters_defeated: 0,
        total_xp: info.xp,
      });
      await updateCharacterXp(info.userId, info.xp);
    }
  }
}
