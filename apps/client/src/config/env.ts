export const ENV = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL ?? '',
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  GAME_SERVER_URL: import.meta.env.VITE_GAME_SERVER_URL ?? 'ws://localhost:2567',
};
