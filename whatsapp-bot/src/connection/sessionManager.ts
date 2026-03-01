import makeWASocket, {
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  isPnUser,
  isJidGroup,
  isJidStatusBroadcast,
  jidNormalizedUser,
  proto,
} from 'baileys';
import type { WASocket } from 'baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { useSupabaseAuthState, clearAuth } from './useSupabaseAuthState.js';
import { getSupabase } from '../config/supabase.js';

// Quiet logger — suppresses noisy Baileys protocol logs
const logger = pino({ level: 'silent' });

// Suppress noisy libsignal session logs
const _origInfo = console.info;
const _origWarn = console.warn;
console.info = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('session')) return;
  _origInfo.apply(console, args);
};
console.warn = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('session')) return;
  _origWarn.apply(console, args);
};

interface SessionEntry {
  sock: WASocket;
  status: 'connecting' | 'qr' | 'connected' | 'disconnected';
  myPhoneJid: string | null;
  reconnectAttempts: number;
  botSentIds: Set<string>;
  msgRetryCache: NodeCache;
  messageStore: Map<string, proto.IMessage>;
}

type MessageHandler = (sock: WASocket, msg: any) => Promise<void>;
type OnQR = (userId: string, qr: string) => void;
type OnStatus = (userId: string, status: string, jid?: string) => void;
type CreateHandler = (userId: string) => MessageHandler;

const MAX_RECONNECT_ATTEMPTS = 5;

const sessions = new Map<string, SessionEntry>();
let _onQR: OnQR = () => {};
let _onStatus: OnStatus = () => {};
let _createHandler: CreateHandler = () => async () => {};

async function getWAVersion(): Promise<[number, number, number]> {
  try {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`WA Web version: ${version.join('.')}, isLatest: ${isLatest}`);
    return version;
  } catch {
    const fallback: [number, number, number] = [2, 3000, 1033105955];
    console.log(`Could not fetch WA version, using fallback: ${fallback.join('.')}`);
    return fallback;
  }
}

export function initSessionManager(onQR: OnQR, onStatus: OnStatus, createHandler: CreateHandler): void {
  _onQR = onQR;
  _onStatus = onStatus;
  _createHandler = createHandler;
  console.log('🔧 Session manager initialized');
}

export async function reconnectAll(): Promise<void> {
  try {
    const { data: users, error } = await getSupabase()
      .from('users')
      .select('id')
      .eq('whatsapp_connected', true);
    if (error || !users || users.length === 0) return;
    console.log(`[SESSION] Reconnecting ${users.length} session(s)...`);
    for (const user of users) {
      connectUser(user.id).catch(err =>
        console.error(`[SESSION] Failed to reconnect user ${user.id}:`, err)
      );
    }
  } catch (err) {
    console.error('[SESSION] reconnectAll error:', err);
  }
}

export async function connectUser(userId: string): Promise<void> {
  // Clean up existing session if any — but only end the socket, keep the entry
  // to preserve botSentIds and other state
  const existing = sessions.get(userId);
  if (existing) {
    try { existing.sock.end(undefined); } catch {}
    sessions.delete(userId);
  }

  const msgRetryCache = new NodeCache({ stdTTL: 300, useClones: false });
  const messageStore = new Map<string, proto.IMessage>();

  const entry: SessionEntry = {
    sock: null as any,
    status: 'connecting',
    myPhoneJid: null,
    reconnectAttempts: 0,
    botSentIds: new Set(),
    msgRetryCache,
    messageStore,
  };
  sessions.set(userId, entry);

  const { state, saveCreds } = await useSupabaseAuthState(userId);
  const version = await getWAVersion();
  const keyStore = makeCacheableSignalKeyStore(state.keys, logger);

  const sock = makeWASocket({
    version,
    logger,
    auth: { creds: state.creds, keys: keyStore },
    browser: Browsers.macOS('Desktop'),
    defaultQueryTimeoutMs: 60_000,
    msgRetryCounterCache: msgRetryCache,
    getMessage: async (key) => {
      const id = key.id;
      if (id && messageStore.has(id)) return messageStore.get(id)!;
      return proto.Message.fromObject({});
    },
    patchMessageBeforeSending: async (msg) => {
      await sock?.uploadPreKeysToServerIfRequired();
      return msg;
    },
  });

  entry.sock = sock;
  const handler = _createHandler(userId);

  sock.ev.process(async (events) => {
    if (events['creds.update']) {
      await saveCreds();
    }

    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update'];

      if (qr) {
        entry.status = 'qr';
        qrcode.generate(qr, { small: true });
        console.log(`[SESSION] User ${userId}: QR generated (${qr.length} chars)`);
        _onQR(userId, qr);
      }

      if (connection === 'close') {
        const current = sessions.get(userId);
        if (current && current.sock !== sock) return;

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

        if (
          statusCode === DisconnectReason.loggedOut ||
          statusCode === DisconnectReason.connectionReplaced
        ) {
          console.log(`[SESSION] User ${userId}: logged out / replaced, clearing auth`);
          try { await clearAuth(userId); } catch {}
          try {
            await getSupabase()
              .from('users')
              .update({ whatsapp_connected: false, whatsapp_jid: null })
              .eq('id', userId);
          } catch {}
          sessions.delete(userId);
          entry.status = 'disconnected';
          _onStatus(userId, 'disconnected');
          return;
        }

        // QR timeout (408) during initial pairing — don't count as reconnect attempt,
        // just retry to get a fresh QR code
        if (statusCode === 408 && !entry.myPhoneJid) {
          console.log(`[SESSION] User ${userId}: QR timeout, generating new QR...`);
          entry.status = 'connecting';
          setTimeout(() => connectUser(userId), 1000);
          return;
        }

        entry.reconnectAttempts++;
        if (entry.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          console.log(`[SESSION] User ${userId}: max reconnect attempts reached`);
          sessions.delete(userId);
          entry.status = 'disconnected';
          _onStatus(userId, 'disconnected');
          return;
        }

        const delay = Math.min(5000 * entry.reconnectAttempts, 30000);
        console.log(`[SESSION] User ${userId}: reconnecting in ${delay / 1000}s (${entry.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        entry.status = 'connecting';
        setTimeout(() => connectUser(userId), delay);
      }

      if (connection === 'open') {
        entry.reconnectAttempts = 0;
        entry.status = 'connected';
        const me = sock.user;
        if (me?.id) {
          entry.myPhoneJid = jidNormalizedUser(me.id);
          console.log(`[SESSION] User ${userId}: connected, jid=${entry.myPhoneJid}`);
          try {
            await getSupabase()
              .from('users')
              .update({ whatsapp_connected: true, whatsapp_jid: entry.myPhoneJid })
              .eq('id', userId);
          } catch (err) { console.error('[SESSION] DB update error:', err); }
          _onStatus(userId, 'connected', entry.myPhoneJid);
        } else {
          console.log(`[SESSION] User ${userId}: connected (no JID available)`);
          try {
            await getSupabase()
              .from('users')
              .update({ whatsapp_connected: true })
              .eq('id', userId);
          } catch {}
          _onStatus(userId, 'connected');
        }
      }
    }

    if (events['messages.upsert']) {
      const { messages, type } = events['messages.upsert'];
      if (type !== 'notify') return;

      for (const msg of messages) {
        const jid = msg.key?.remoteJid || '';
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

        if (isJidGroup(jid) || isJidStatusBroadcast(jid)) continue;
        if (!isPnUser(jid) && !jid.endsWith('@lid')) continue;

        const msgId = msg.key?.id || '';
        if (entry.botSentIds.has(msgId)) {
          entry.botSentIds.delete(msgId);
          continue;
        }

        const hasVoiceNote = !!(msg.message?.audioMessage?.ptt);
        if (!text.trim() && !hasVoiceNote) continue;

        console.log(`[SESSION] User ${userId}: processing ${hasVoiceNote ? '[voice note]' : `"${text.slice(0, 50)}"`}`);
        try {
          await handler(sock, msg);
        } catch (err) {
          console.error(`[SESSION] User ${userId}: handler error:`, err);
        }
      }
    }
  });
}

export async function disconnectUser(userId: string): Promise<void> {
  const entry = sessions.get(userId);
  if (!entry) return;
  entry.sock.end(undefined);
  sessions.delete(userId);
  try { await clearAuth(userId); } catch {}
  try {
    await getSupabase()
      .from('users')
      .update({ whatsapp_connected: false, whatsapp_jid: null })
      .eq('id', userId);
  } catch {}
}

export function getSocketForUser(userId: string): WASocket | null {
  const entry = sessions.get(userId);
  if (!entry || entry.status !== 'connected') return null;
  return entry.sock;
}

export function getSessionStatus(userId: string): string {
  return sessions.get(userId)?.status ?? 'disconnected';
}

export function getMyPhoneJid(userId: string): string | null {
  return sessions.get(userId)?.myPhoneJid ?? null;
}

export function trackSentMessage(userId: string, id: string): void {
  const entry = sessions.get(userId);
  if (!entry) return;
  entry.botSentIds.add(id);
  setTimeout(() => entry.botSentIds.delete(id), 60_000);
}

export function storeSentMessage(userId: string, id: string, message: proto.IMessage): void {
  const entry = sessions.get(userId);
  if (!entry) return;
  entry.messageStore.set(id, message);
  setTimeout(() => entry.messageStore.delete(id), 1_800_000);
}
