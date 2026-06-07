import { Room, Client } from '@colyseus/core';
import { DuelRoomState } from '../schema/DuelRoomState.js';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { validateSupabaseToken } from '../auth/validateToken.js';
import { persistMatchResult, incrementPlayerStats } from '../db/supabase.js';
import { CLASS_DEFINITIONS, DUEL_DURATION_MS, TICK_MS, ENERGY_REGEN_PER_TICK, CHAT_MAX_LENGTH, ALIAS_MAX_LENGTH } from '@fmr/shared';
import { sanitizeAlias, clamp } from '@fmr/shared';
import { MSG } from '@fmr/shared';
import type { AbilityKey, PlayerClass, PlayerInputPayload } from '@fmr/shared';

export interface DuelJoinOptions {
  alias?: string;
  classKey?: PlayerClass;
  authToken?: string;
  guestId?: string;
}

export class DuelRoom extends Room<{ state: DuelRoomState }> {
  maxClients = 2;
  private combat = new CombatSystem();
  private playerUserIds: Map<string, string | null> = new Map();
  private startedAt = new Date();
  private inputQueue: Map<string, PlayerInputPayload[]> = new Map();

  onCreate() {
    this.setState(new DuelRoomState());
    this.state.remainingMs = DUEL_DURATION_MS;

    this.setSimulationInterval((delta) => this.tick(delta), TICK_MS);

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

    console.log(`[DuelRoom] ${this.roomId} created`);
  }

  async onJoin(client: Client, options: DuelJoinOptions) {
    const alias = sanitizeAlias(options.alias ?? 'Fighter', 2, ALIAS_MAX_LENGTH);
    const classKey = (options.classKey as PlayerClass) ?? 'wolf_guardian';
    const classDef = CLASS_DEFINITIONS[classKey] ?? CLASS_DEFINITIONS.wolf_guardian;

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

    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.userId = userId ?? '';
    player.guestId = options.guestId ?? '';
    player.alias = alias;
    player.classKey = classKey;
    player.x = this.state.players.size === 0 ? 300 : 1300;
    player.y = 600;
    player.hp = classDef.stats.maxHp;
    player.maxHp = classDef.stats.maxHp;
    player.energy = classDef.stats.maxEnergy;
    player.maxEnergy = classDef.stats.maxEnergy;
    player.moveSpeed = classDef.stats.moveSpeed;
    player.attackDamage = classDef.stats.attackDamage;
    player.attackRange = classDef.stats.attackRange;
    player.authMode = authMode;
    player.teamId = this.state.players.size;
    player.isAlive = true;

    this.state.players.set(client.sessionId, player);
    this.inputQueue.set(client.sessionId, []);

    if (this.state.players.size === 2) {
      this.state.matchActive = true;
      this.startedAt = new Date();
      console.log(`[DuelRoom] Match started`);
    }
  }

  onLeave(client: Client) {
    if (this.state.matchActive && !this.state.matchEnded) {
      // Remaining player wins by disconnect
      this.state.players.forEach((_p: PlayerSchema, sid: string) => {
        if (sid !== client.sessionId) {
          this.endMatch(sid);
        }
      });
    }
    this.state.players.delete(client.sessionId);
    this.inputQueue.delete(client.sessionId);
  }

  async onDispose() {
    if (!this.state.matchEnded) {
      await this.endMatch(null);
    }
  }

  private tick(deltaMs: number) {
    if (!this.state.matchActive || this.state.matchEnded) return;
    const now = Date.now();
    this.state.elapsedMs += deltaMs;
    this.state.remainingMs -= deltaMs;

    // Check time out
    if (this.state.remainingMs <= 0) {
      this.determineWinnerByHp();
      return;
    }

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

      const len = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
      if (len > 0) {
        const nx = totalDx / len;
        const ny = totalDy / len;
        const speed = player.moveSpeed;
        const dt = deltaMs / 1000;
        player.x = clamp(player.x + nx * speed * dt, 60, 1540);
        player.y = clamp(player.y + ny * speed * dt, 60, 1140);
        player.direction = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 'right' : 'left') : (ny > 0 ? 'down' : 'up');
        player.animState = 'walk';
      } else if (player.animState === 'walk') {
        player.animState = 'idle';
      }

      if (abilityToUse === 'basic') {
        const results = this.combat.applyPlayerAttack(sessionId, latestAimX, latestAimY, this.state.players, this.state.players, now);
        results.forEach((r) => {
          this.broadcast(MSG.DAMAGE_EVENT, { targetId: r.targetId, sourceId: sessionId, amount: r.amount, isPlayer: r.isPlayer });
          if (r.killed && r.isPlayer) {
            // Check winner
            const deadPlayer = this.state.players.get(r.targetId);
            if (deadPlayer) this.endMatch(sessionId);
          }
        });
      } else if (abilityToUse) {
        const results = this.combat.applyAbility(sessionId, abilityToUse, latestAimX, latestAimY, this.state.players, this.state.players, now);
        results.forEach((r) => {
          this.broadcast(MSG.DAMAGE_EVENT, { targetId: r.targetId, sourceId: sessionId, amount: r.amount, isPlayer: r.isPlayer });
          if (r.killed && r.isPlayer) this.endMatch(sessionId);
        });
      }

      player.energy = clamp(player.energy + ENERGY_REGEN_PER_TICK, 0, player.maxEnergy);
    });

    // Respawn (in duel, no respawn — use as death marker)
    this.state.players.forEach((player: PlayerSchema) => {
      if (!player.isAlive && !this.state.matchEnded) {
        let winnerId: string | null = null;
        this.state.players.forEach((p: PlayerSchema, sid: string) => {
          if (p.isAlive) winnerId = sid;
        });
        if (winnerId) this.endMatch(winnerId);
      }
    });
  }

  private determineWinnerByHp() {
    let winnerId: string | null = null;
    let maxHp = -1;
    this.state.players.forEach((p: PlayerSchema, sid: string) => {
      if (p.hp > maxHp) {
        maxHp = p.hp;
        winnerId = sid;
      }
    });
    this.endMatch(winnerId);
  }

  private async endMatch(winnerSessionId: string | null) {
    if (this.state.matchEnded) return;
    this.state.matchEnded = true;
    this.state.matchActive = false;

    const winner = winnerSessionId ? this.state.players.get(winnerSessionId) : null;
    this.state.winnerPlayerId = winnerSessionId ?? '';
    this.state.winnerAlias = winner?.alias ?? '';

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - this.startedAt.getTime();

    const stats: Array<{ playerId: string; alias: string; hp: number; xpGained: number }> = [];
    this.state.players.forEach((p: PlayerSchema, sid: string) => {
      stats.push({ playerId: sid, alias: p.alias, hp: p.hp, xpGained: 0 });
    });

    this.broadcast(MSG.MATCH_END, {
      mode: 'duel',
      winnerUserId: winner?.userId ?? null,
      winnerAlias: winner?.alias ?? null,
      reason: 'elimination',
      durationMs,
      stats,
    });

    const winnerUserId = winner?.userId || null;
    await persistMatchResult({
      roomId: this.roomId,
      mode: 'duel',
      winnerUserId,
      startedAt: this.startedAt,
      endedAt,
      metadata: { stats },
    });

    for (const [sid] of this.state.players) {
      const userId = this.playerUserIds.get(sid);
      if (!userId) continue;
      const isWinner = sid === winnerSessionId;
      await incrementPlayerStats(userId, {
        games_played: 1,
        duels_won: isWinner ? 1 : 0,
        duels_lost: isWinner ? 0 : 1,
      });
    }

    this.disconnect();
  }
}
