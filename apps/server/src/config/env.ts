import 'dotenv/config';

export const env = {
  PORT: parseInt(process.env.PORT ?? '2567', 10),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
};

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[config] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — persistence will be disabled'
  );
}
