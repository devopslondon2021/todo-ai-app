import { BufferJSON, initAuthCreds, proto } from 'baileys';
import type { AuthenticationCreds, SignalKeyStore } from 'baileys';
import { getSupabase } from '../config/supabase.js';

const TABLE = 'baileys_auth';

function serialize(value: unknown): object {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function deserialize<T>(data: unknown): T {
  return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
}

async function readRow(userId: string, key: string): Promise<unknown | null> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('data')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.data ?? null;
}

async function writeRow(userId: string, key: string, value: unknown): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLE)
    .upsert({ user_id: userId, key, data: serialize(value), updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function deleteRow(userId: string, key: string): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('key', key);
  if (error) throw error;
}

export async function clearAuth(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

export async function useSupabaseAuthState(userId: string): Promise<{
  state: { creds: AuthenticationCreds; keys: SignalKeyStore };
  saveCreds: () => Promise<void>;
}> {
  const raw = await readRow(userId, 'creds');
  const creds: AuthenticationCreds = raw ? deserialize(raw) : initAuthCreds();

  const keys: SignalKeyStore = {
    async get(type, ids) {
      const keyNames: string[] = ids.map((id) => `${type}-${id}`);
      const { data, error } = await getSupabase()
        .from(TABLE)
        .select('key, data')
        .eq('user_id', userId)
        .in('key', keyNames);
      if (error) throw error;

      const result: Record<string, any> = {};
      for (const row of data ?? []) {
        const id = row.key.slice(type.length + 1);
        let value = deserialize(row.data);
        if (type === 'app-state-sync-key') {
          value = proto.Message.AppStateSyncKeyData.fromObject(value as any);
        }
        result[id] = value;
      }
      return result;
    },

    async set(data) {
      const ops: Promise<void>[] = [];
      for (const [category, entries] of Object.entries(data)) {
        for (const [id, value] of Object.entries(entries ?? {})) {
          const key = `${category}-${id}`;
          ops.push(value ? writeRow(userId, key, value) : deleteRow(userId, key));
        }
      }
      await Promise.all(ops);
    },
  };

  return {
    state: { creds, keys },
    saveCreds: () => writeRow(userId, 'creds', creds),
  };
}
