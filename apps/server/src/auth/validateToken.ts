import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Anon client — used only to validate JWT tokens from clients
const anonClient = env.SUPABASE_URL && env.SUPABASE_ANON_KEY
  ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    })
  : null;

export interface ValidatedUser {
  userId: string;
  email: string | null;
}

export async function validateSupabaseToken(token: string): Promise<ValidatedUser | null> {
  if (!anonClient) return null;
  try {
    const { data, error } = await anonClient.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}
