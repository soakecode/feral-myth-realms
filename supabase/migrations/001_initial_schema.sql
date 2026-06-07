-- ============================================================
-- Feral Myth: Realms — Initial Schema
-- ============================================================
-- Run this first in Supabase SQL Editor or via supabase db push.
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---- Helper: auto-update updated_at ----
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- profiles
-- One row per authenticated user. Created on first login/signup.
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE NOT NULL
    CONSTRAINT username_length CHECK (char_length(username) BETWEEN 2 AND 30)
    CONSTRAINT username_format CHECK (username ~ '^[a-z0-9_\-]+$'),
  display_name  TEXT
    CONSTRAINT display_name_length CHECK (char_length(display_name) <= 40),
  avatar_key    TEXT DEFAULT 'default',
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE profiles IS 'Public player profiles. One per auth.users row.';
COMMENT ON COLUMN profiles.username IS 'Unique lowercase identifier, URL-safe.';
COMMENT ON COLUMN profiles.display_name IS 'Display name shown in game UI.';
COMMENT ON COLUMN profiles.avatar_key IS 'Key referencing the selected avatar/class art.';

-- ============================================================
-- characters
-- Each user can have one active character per class.
-- ============================================================
CREATE TABLE IF NOT EXISTS characters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL
    CONSTRAINT character_name_length CHECK (char_length(name) BETWEEN 2 AND 30),
  class_key   TEXT NOT NULL
    CONSTRAINT class_key_valid CHECK (class_key IN ('stag_druid','raven_witch','wolf_guardian','fox_trickster')),
  level       INTEGER DEFAULT 1 NOT NULL CHECK (level >= 1 AND level <= 100),
  xp          INTEGER DEFAULT 0 NOT NULL CHECK (xp >= 0),
  gold        INTEGER DEFAULT 0 NOT NULL CHECK (gold >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id, class_key)  -- One character per class per user
);

CREATE INDEX idx_characters_user_id ON characters (user_id);

CREATE TRIGGER trg_characters_updated_at
  BEFORE UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE characters IS 'Player characters. One per class per user.';

-- ============================================================
-- player_stats
-- Aggregated lifetime statistics per user.
-- ============================================================
CREATE TABLE IF NOT EXISTS player_stats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  games_played      INTEGER DEFAULT 0 NOT NULL CHECK (games_played >= 0),
  wins              INTEGER DEFAULT 0 NOT NULL CHECK (wins >= 0),
  losses            INTEGER DEFAULT 0 NOT NULL CHECK (losses >= 0),
  monsters_defeated INTEGER DEFAULT 0 NOT NULL CHECK (monsters_defeated >= 0),
  duels_won         INTEGER DEFAULT 0 NOT NULL CHECK (duels_won >= 0),
  duels_lost        INTEGER DEFAULT 0 NOT NULL CHECK (duels_lost >= 0),
  total_xp          INTEGER DEFAULT 0 NOT NULL CHECK (total_xp >= 0),
  updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TRIGGER trg_player_stats_updated_at
  BEFORE UPDATE ON player_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE player_stats IS 'Lifetime aggregated stats per user. Upserted after each match.';

-- ============================================================
-- match_history
-- One row per completed match. Metadata stored as JSONB.
-- ============================================================
CREATE TABLE IF NOT EXISTS match_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('realm', 'duel')),
  winner_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  ended_at        TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'::JSONB NOT NULL
);

CREATE INDEX idx_match_history_winner ON match_history (winner_user_id);
CREATE INDEX idx_match_history_started ON match_history (started_at DESC);

COMMENT ON TABLE match_history IS 'Record of every completed match. Used for leaderboards and history.';
COMMENT ON COLUMN match_history.metadata IS 'Flexible JSON payload: player stats, reasons, class data, etc.';

-- ============================================================
-- friend_codes
-- Each registered user gets one permanent friend code.
-- Used to invite others and future friends feature.
-- ============================================================
CREATE TABLE IF NOT EXISTS friend_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code        TEXT UNIQUE NOT NULL
    CONSTRAINT code_format CHECK (code ~ '^[A-Z2-9]{8}$'),
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_friend_codes_code ON friend_codes (code);

COMMENT ON TABLE friend_codes IS 'Permanent invite codes for registered users. 8 uppercase alphanumeric chars.';

-- ============================================================
-- Auto-create profile + stats + friend_code on new user signup
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_username TEXT;
  new_code     TEXT;
BEGIN
  -- Derive username from email or metadata
  new_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    LOWER(SPLIT_PART(NEW.email, '@', 1))
  );

  -- Sanitize username (keep only a-z0-9_-)
  new_username := LOWER(REGEXP_REPLACE(new_username, '[^a-z0-9_\-]', '', 'g'));
  new_username := SUBSTRING(new_username FROM 1 FOR 20);
  IF char_length(new_username) < 2 THEN
    new_username := 'player_' || LEFT(NEW.id::TEXT, 6);
  END IF;

  -- Handle username conflicts
  WHILE EXISTS (SELECT 1 FROM profiles WHERE username = new_username) LOOP
    new_username := new_username || '_' || FLOOR(RANDOM() * 100)::TEXT;
  END LOOP;

  -- Create profile
  INSERT INTO profiles (id, username, display_name, avatar_key)
  VALUES (
    NEW.id,
    new_username,
    COALESCE(NEW.raw_user_meta_data->>'display_name', new_username),
    'default'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Create player stats
  INSERT INTO player_stats (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Generate friend code (retry until unique)
  LOOP
    new_code := UPPER(SUBSTRING(ENCODE(GEN_RANDOM_BYTES(6), 'base64') FROM 1 FOR 8));
    new_code := REGEXP_REPLACE(new_code, '[^A-Z2-9]', 'A', 'g');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM friend_codes WHERE code = new_code);
  END LOOP;

  INSERT INTO friend_codes (user_id, code)
  VALUES (NEW.id, new_code)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
