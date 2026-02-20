import { getSupabase } from '../config/supabase';
import type { User } from '../types';

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function getOrCreateByJid(jid: string): Promise<User> {
  const { data: existing } = await getSupabase()
    .from('users')
    .select('*')
    .eq('whatsapp_jid', jid)
    .single();

  if (existing) return existing;

  // Extract phone number from JID (format: 1234567890@s.whatsapp.net)
  const phone = jid.split('@')[0];

  const { data: user, error } = await getSupabase()
    .from('users')
    .insert({ whatsapp_jid: jid, phone_number: phone, name: phone })
    .select('*')
    .single();

  if (error) throw error;

  // Seed default categories
  await getSupabase().rpc('seed_default_categories', { p_user_id: user.id });

  return user;
}

export async function createUser(data: { name?: string; phone_number?: string }): Promise<User> {
  const { data: user, error } = await getSupabase()
    .from('users')
    .insert(data)
    .select('*')
    .single();

  if (error) throw error;

  await getSupabase().rpc('seed_default_categories', { p_user_id: user.id });

  return user;
}

export async function getUserByApiKey(apiKey: string): Promise<User | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('api_key', apiKey)
    .single();

  if (error) return null;
  return data;
}

export async function getApiKey(userId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('api_key')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data?.api_key || null;
}

export async function regenerateApiKey(userId: string): Promise<string> {
  const { data, error } = await getSupabase()
    .rpc('generate_api_key');

  if (error) throw new Error('Failed to generate API key');

  const newKey = data as string;

  const { error: updateError } = await getSupabase()
    .from('users')
    .update({ api_key: newKey })
    .eq('id', userId);

  if (updateError) throw updateError;
  return newKey;
}

export async function getOrCreateDefault(): Promise<User> {
  // Get the first user or create a default one
  const { data: users } = await getSupabase()
    .from('users')
    .select('*')
    .limit(1);

  if (users && users.length > 0) return users[0];

  return createUser({ name: 'Default User' });
}
