-- ============================================================
-- Feral Myth: Realms — Seed Data
-- ============================================================
-- Optional: creates test data for local development.
-- Do NOT run in production unless you want test accounts.
-- ============================================================

-- Note: auth.users rows must be created via Supabase Auth API.
-- This seed only adds supplemental data for testing queries.

-- Example: verify the trigger works by checking if profiles exist
-- after user creation via Supabase Dashboard > Auth > Users

-- ---- Verify RLS is active ----
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'profiles') > 0,
    'RLS policies on profiles table are missing. Run 002_rls_policies.sql first.';
  ASSERT (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'characters') > 0,
    'RLS policies on characters table are missing. Run 002_rls_policies.sql first.';
  RAISE NOTICE 'Schema verification passed.';
END;
$$;

-- ---- Game balance constants (informational comment, not SQL) ----
-- These are enforced in application code (packages/shared/src/balance/).
-- They are documented here for reference:
--
-- Classes:     stag_druid | raven_witch | wolf_guardian | fox_trickster
-- Max level:   100
-- XP per level: 100 * level
-- Max HP range: 90 (raven_witch) – 180 (wolf_guardian)
-- Move speed:  145 (wolf) – 200 (fox)
--
-- Enemy types: wisp | bramble_beast | rune_imp
-- Respawn time: 15 seconds
-- Player respawn: 5 seconds
-- Duel duration: 3 minutes
-- Sanctuary capture: 100 progress units, 0.5/tick base
