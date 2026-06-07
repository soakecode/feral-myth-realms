-- ============================================================
-- Feral Myth: Realms — Row Level Security Policies
-- ============================================================
-- Run AFTER 001_initial_schema.sql
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters    ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_codes  ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- profiles
-- ============================================================

-- Anyone can read public profile info (for lobby display)
CREATE POLICY "profiles_select_public"
  ON profiles FOR SELECT
  USING (TRUE);

-- Users can only insert their own profile
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can only update their own profile
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users cannot delete profiles (admin only via service role)
-- No DELETE policy = no client deletes

-- ============================================================
-- characters
-- ============================================================

-- Users can read their own characters
CREATE POLICY "characters_select_own"
  ON characters FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create characters for themselves
CREATE POLICY "characters_insert_own"
  ON characters FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own characters
CREATE POLICY "characters_update_own"
  ON characters FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- player_stats
-- ============================================================

-- Users can read their own stats
CREATE POLICY "player_stats_select_own"
  ON player_stats FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert/update stats (server-side only)
-- No INSERT/UPDATE policies for anon/authenticated roles.
-- The server uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS.

-- ============================================================
-- match_history
-- ============================================================

-- Users can read match history where they were the winner
-- or where they appear in metadata (limited read)
CREATE POLICY "match_history_select_winner"
  ON match_history FOR SELECT
  USING (
    winner_user_id = auth.uid()
    OR metadata::TEXT LIKE '%' || auth.uid()::TEXT || '%'
  );

-- Service role writes match history (server only)

-- ============================================================
-- friend_codes
-- ============================================================

-- Users can read their own friend code
CREATE POLICY "friend_codes_select_own"
  ON friend_codes FOR SELECT
  USING (auth.uid() = user_id);

-- Anyone can look up a code (to join via friend code)
-- This allows the lobby to resolve codes without auth
CREATE POLICY "friend_codes_select_by_code"
  ON friend_codes FOR SELECT
  USING (TRUE);

-- ============================================================
-- Notes on service role usage:
-- The Colyseus server uses SUPABASE_SERVICE_ROLE_KEY which
-- bypasses ALL RLS policies. This key must NEVER be sent to
-- the client. All writes to player_stats and match_history
-- happen exclusively through the server.
-- ============================================================
