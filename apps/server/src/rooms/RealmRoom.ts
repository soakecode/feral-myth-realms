import { Room, Client } from '@colyseus/core';
import { RealmRoomState } from '../schema/RealmRoomState.js';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import { StructureSchema } from '../schema/StructureSchema.js';
import { EnemyAI } from '../systems/EnemyAI.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { initSanctuaries, tickSanctuaries } from '../systems/SanctuarySystem.js';
import { WorldSystem } from '../systems/WorldSystem.js';
import { validateSupabaseToken } from '../auth/validateToken.js';
import { persistMatchResult, incrementPlayerStats, updateCharacterXp } from '../db/supabase.js';
import {
  CLASS_DEFINITIONS, CHAT_MAX_LENGTH, ALIAS_MAX_LENGTH, TICK_MS, ENERGY_REGEN_PER_TICK,
  WORLD, XP_PER_ENEMY_KILL, HARVEST_COOLDOWN_MS,
} from '@fmr/shared';
import { sanitizeAlias, clamp, generateRoomCode, isBlocked, slowFactorAt, levelFromXp, distance } from '@fmr/shared';
import { MSG } from '@fmr/shared';
import type { AbilityKey, PlayerClass, PlayerInputPayload, StructureType } from '@fmr/shared';

function sanctumSpawn(): { x: number; y: number } {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * (WORLD.sanctum.r - 80);
  return { x: WORLD.sanctum.x + Math.cos(a) * r, y: WORLD.sanctum.y + Math.sin(a) * r };
}

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
  private world = new WorldSystem();
  private xpAccumulated: Map<string, number> = new Map();
  private playerUserIds: Map<string, string | null> = new Map();
  private harvestCd: Map<string, number> = new Map();
  private startedAt = new Date();
  private roomCode = generateRoomCode();
  private inputQueue: Map<string, PlayerInputPayload[]> = new Map();

  onCreate(options: RealmJoinOptions) {
    this.setState(new RealmRoomState());
    this.enemyAI.initEnemies(this.state.enemies);
    initSanctuaries(this.state.sanctuaries);
    this.world.initResources(this.state.resources);

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

    this.onMessage(MSG.HARVEST, (client, payload: { nodeId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isAlive) return;
      const last = this.harvestCd.get(client.sessionId) ?? 0;
      if (Date.now() - last < HARVEST_COOLDOWN_MS) return;
      const res = this.world.harvest(player, payload.nodeId, this.state.resources);
      if (res) {
        this.harvestCd.set(client.sessionId, Date.now());
        this.awardXp(client.sessionId, res.xp);
        client.send(MSG.RESOURCE_GAINED, { type: res.type, amount: res.amount });
      }
    });

    this.onMessage(MSG.BUILD, (client, payload: { structureType: StructureType; x: number; y: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isAlive) return;
      const result = this.world.build(player, payload.structureType, payload.x, payload.y, this.state.structures);
      if ('error' in result) {
        client.send(MSG.BUILD_DENIED, { reason: result.error });
      } else {
        this.awardXp(client.sessionId, result.xp);
        this.broadcast(MSG.STRUCTURE_BUILT, { type: result.type, x: payload.x, y: payload.y, ownerId: client.sessionId, ownerAlias: player.alias });
      }
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
    const spawn = sanctumSpawn();
    player.x = spawn.x;
    player.y = spawn.y;
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
      let abilityToUse: AbilityKey | null = null;

      for (const input of queue) {
        totalDx += input.dx;
        totalDy += input.dy;
        latestAimX = input.aimX;
        latestAimY = input.aimY;
        if (input.abilityKey) abilityToUse = input.abilityKey;
      }
      this.inputQueue.set(sessionId, []);

      // Normalize movement + obstacle collision (axis-separated so you slide).
      const len = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
      if (len > 0) {
        const nx = totalDx / len;
        const ny = totalDy / len;
        const dt = deltaMs / 1000;
        const step = player.moveSpeed * slowFactorAt(player.x, player.y) * dt;
        const tryX = clamp(player.x + nx * step, 24, WORLD.width - 24);
        const tryY = clamp(player.y + ny * step, 24, WORLD.height - 24);
        if (!isBlocked(tryX, player.y, 16)) player.x = tryX;
        if (!isBlocked(player.x, tryY, 16)) player.y = tryY;

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
            const enemyType = this.state.enemies.get(r.targetId)?.type ?? 'wisp';
            this.awardXp(sessionId, XP_PER_ENEMY_KILL[enemyType] ?? 10);
            this.broadcast(MSG.ENEMY_DIED, { enemyId: r.targetId, killerId: sessionId, enemyType });
          }
        });
      } else if (abilityToUse) {
        const results = this.combat.applyAbility(sessionId, abilityToUse, latestAimX, latestAimY, this.state.players, this.state.enemies, now);
        results.forEach((r) => {
          this.broadcast(MSG.DAMAGE_EVENT, { targetId: r.targetId, sourceId: sessionId, amount: r.amount, isPlayer: r.isPlayer });
          if (r.killed && !r.isPlayer) {
            const enemyType = this.state.enemies.get(r.targetId)?.type ?? 'wisp';
            this.awardXp(sessionId, XP_PER_ENEMY_KILL[enemyType] ?? 10);
            this.broadcast(MSG.ENEMY_DIED, { enemyId: r.targetId, killerId: sessionId, enemyType });
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

    // Enemy AI tick (walls block creatures)
    const enemyDamage = this.enemyAI.tick(this.state.enemies, this.state.players, deltaMs, now, this.state.structures);
    enemyDamage.forEach((ev) => {
      this.broadcast(MSG.DAMAGE_EVENT, { targetId: ev.targetId, sourceId: ev.sourceId, amount: ev.amount, isPlayer: true });
    });

    // Sanctuary tick
    tickSanctuaries(this.state.sanctuaries, this.state.players, deltaMs);

    // World tick: resource respawns + structure effects (campfire heal)
    this.world.tickResources(this.state.resources, deltaMs);
    this.world.tickStructures(this.state.structures, this.state.players);
  }

  private respawnPlayer(player: PlayerSchema) {
    const classDef = CLASS_DEFINITIONS[player.classKey as PlayerClass];
    player.hp = player.maxHp || classDef?.stats.maxHp || 100;
    player.energy = player.maxEnergy || classDef?.stats.maxEnergy || 100;
    // Forward respawn at the nearest shelter, else the sanctum glade.
    const shelter = this.nearestShelter(player.x, player.y);
    const spawn = shelter
      ? { x: shelter.x + (Math.random() - 0.5) * 70, y: shelter.y + (Math.random() - 0.5) * 70 }
      : sanctumSpawn();
    player.x = spawn.x;
    player.y = spawn.y;
    player.isAlive = true;
    player.animState = 'idle';
    player.respawnTimer = 0;
    this.broadcast(MSG.PLAYER_RESPAWNED, { playerId: player.id });
  }

  private nearestShelter(x: number, y: number): StructureSchema | null {
    let best: StructureSchema | null = null;
    let bestD = Infinity;
    this.state.structures.forEach((s: StructureSchema) => {
      if (s.type !== 'shelter') return;
      const d = distance(x, y, s.x, s.y);
      if (d < bestD) { bestD = d; best = s; }
    });
    return best;
  }

  private awardXp(sessionId: string, amount: number) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.xp += amount;
    this.xpAccumulated.set(sessionId, (this.xpAccumulated.get(sessionId) ?? 0) + amount);
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send(MSG.XP_GAINED, { playerId: sessionId, amount, total: player.xp });

    // Level up: small permanent stat bump + full heal.
    const newLevel = levelFromXp(player.xp);
    if (newLevel > player.level) {
      player.level = newLevel;
      player.maxHp += 10;
      player.maxEnergy += 5;
      player.attackDamage += 2;
      player.hp = player.maxHp;
      player.energy = player.maxEnergy;
      client?.send(MSG.LEVEL_UP, { playerId: sessionId, level: newLevel });
    }
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

    for (const info of Object.values(playerSummary)) {
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
