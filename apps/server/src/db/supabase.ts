import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Admin client — uses service role key, bypasses RLS
// NEVER expose this client or key to the browser
let _adminClient: ReturnType<typeof createClient> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export function getAdminClient() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!_adminClient) {
    _adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _adminClient;
}

export async function persistMatchResult(params: {
  roomId: string;
  mode: string;
  winnerUserId: string | null;
  startedAt: Date;
  endedAt: Date;
  metadata: AnyRecord;
}) {
  const db = getAdminClient();
  if (!db) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from('match_history').insert({
    room_id: params.roomId,
    mode: params.mode,
    winner_user_id: params.winnerUserId,
    started_at: params.startedAt.toISOString(),
    ended_at: params.endedAt.toISOString(),
    metadata: params.metadata,
  });
}

export async function incrementPlayerStats(
  userId: string,
  delta: {
    games_played?: number;
    wins?: number;
    losses?: number;
    monsters_defeated?: number;
    duels_won?: number;
    duels_lost?: number;
    total_xp?: number;
  }
) {
  const db = getAdminClient();
  if (!db) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: existing } = await anyDb
    .from('player_stats')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) {
    await anyDb.from('player_stats').insert({
      user_id: userId,
      games_played: delta.games_played ?? 0,
      wins: delta.wins ?? 0,
      losses: delta.losses ?? 0,
      monsters_defeated: delta.monsters_defeated ?? 0,
      duels_won: delta.duels_won ?? 0,
      duels_lost: delta.duels_lost ?? 0,
      total_xp: delta.total_xp ?? 0,
    });
  } else {
    await anyDb
      .from('player_stats')
      .update({
        games_played: existing.games_played + (delta.games_played ?? 0),
        wins: existing.wins + (delta.wins ?? 0),
        losses: existing.losses + (delta.losses ?? 0),
        monsters_defeated: existing.monsters_defeated + (delta.monsters_defeated ?? 0),
        duels_won: existing.duels_won + (delta.duels_won ?? 0),
        duels_lost: existing.duels_lost + (delta.duels_lost ?? 0),
        total_xp: existing.total_xp + (delta.total_xp ?? 0),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }
}

export async function updateCharacterXp(userId: string, xpGained: number) {
  const db = getAdminClient();
  if (!db) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { data: char } = await anyDb
    .from('characters')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!char) return;

  const newXp = char.xp + xpGained;
  const newLevel = Math.floor(newXp / 100) + 1;

  await anyDb
    .from('characters')
    .update({
      xp: newXp,
      level: newLevel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', char.id);
}
