import { createClient } from '@supabase/supabase-js';
import { ENV } from '../config/env.js';

export const supabase = ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY
  ? createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY)
  : null;

export async function getCurrentSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getCurrentUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function signUp(email: string, password: string, username: string) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (data.user) {
    await supabase.from('profiles').upsert({
      id: data.user.id,
      username: username.toLowerCase().trim(),
      display_name: username,
    });
  }
  return data;
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getProfile(userId: string) {
  if (!supabase) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data;
}

export async function getCharacter(userId: string) {
  if (!supabase) return null;
  const { data } = await supabase
    .from('characters')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function createCharacter(userId: string, name: string, classKey: string) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('characters')
    .insert({ user_id: userId, name, class_key: classKey })
    .select()
    .single();
  if (error) throw error;
  return data;
}
