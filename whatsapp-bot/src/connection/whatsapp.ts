import makeWASocket, {
  useMultiFileAuthState,
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
import * as path from 'path';

// Quiet logger — suppresses noisy Baileys protocol logs
const logger = pino({ level: 'silent' });

// Suppress noisy libsignal console.info/warn about session management.
// These are normal during session establishment and not actionable.
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

// Retry counter cache — tracks message retry counts to prevent infinite loops
const msgRetryCounterCache = new NodeCache({ stdTTL: 300, useClones: false });

const AUTH_DIR = path.join(process.cwd(), 'auth_info_baileys');

let sock: WASocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Track message IDs sent by the bot to prevent infinite loops in self-chat
const botSentIds = new Set<string>();

// Store sent message content for retry re-encryption.
// When WhatsApp requests a retry, Baileys needs the original message content
// to re-encrypt it. Without this, the Signal session ratchet gets corrupted.
const messageStore = new Map<string, proto.IMessage>();

// Bot's own phone JID (set on connection open)
let myPhoneJid: string | null = null;

type MessageHandler = (sock: WASocket, msg: any) => Promise<void>;

async function getWAVersion(): Promise<[number, number, number]> {
  try {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`WA Web version: ${version.join('.')}, isLatest: ${isLatest}`);
    return version;
  } catch (err) {
    const fallback: [number, number, number] = [2, 3000, 1033105955];
    console.log(`Could not fetch WA version, using fallback: ${fallback.join('.')}`);
    return fallback;
  }
}

export function getMyPhoneJid(): string | null {
  return myPhoneJid;
}

export function storeSentMessage(id: string, message: proto.IMessage) {
  messageStore.set(id, message);
  // Keep for 30 min so late retry requests can be fulfilled
  setTimeout(() => messageStore.delete(id), 1_800_000);
}

export async function connectWhatsApp(onMessage: MessageHandler): Promise<WASocket> {
  if (sock) {
    sock.ev.removeAllListeners('connection.update');
    sock.ev.removeAllListeners('messages.upsert');
    sock.ev.removeAllListeners('creds.update');
    sock.end(undefined);
    sock = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const version = await getWAVersion();

  // Wrap keys in cacheable store — adds LRU cache layer that prevents
  // concurrent key write operations from corrupting the Signal session
  const keyStore = makeCacheableSignalKeyStore(state.keys, logger);

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: keyStore,
    },
    browser: Browsers.macOS('Desktop'),
    defaultQueryTimeoutMs: 60_000,
    msgRetryCounterCache,
    // Always return content for retry requests — returning undefined/null
    // causes Baileys to fail the retry, which corrupts the Signal session.
    getMessage: async (key) => {
      const id = key.id;
      if (id && messageStore.has(id)) {
        return messageStore.get(id)!;
      }
      // Return empty proto Message (not undefined) to prevent session corruption
      return proto.Message.fromObject({});
    },
    // Ensure pre-keys are uploaded before every send — prevents "Invalid PreKey ID"
    patchMessageBeforeSending: async (msg) => {
      await sock?.uploadPreKeysToServerIfRequired();
      return msg;
    },
  });

  const currentSock = sock;

  // Use ev.process for batched, atomic event handling.
  // This ensures credential saves from Signal session ratcheting happen
  // atomically with message processing, preventing partial-save corruption.
  currentSock.ev.process(async (events) => {
    if (events['creds.update']) {
      await saveCreds();
    }

    if (events['connection.update']) {
      const update = events['connection.update'];
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrcode.generate(qr, { small: true });
        console.log('📱 Scan the QR code above with WhatsApp to connect.\n');
      }

      if (connection === 'close') {
        if (sock !== currentSock) return;

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('Logged out. Delete auth_info_baileys/ and restart.');
          sock = null;
          return;
        }

        if (statusCode === DisconnectReason.connectionReplaced) {
          console.log('Connection replaced by another session.');
          sock = null;
          return;
        }

        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          console.log(`Failed after ${MAX_RECONNECT_ATTEMPTS} attempts.`);
          sock = null;
          return;
        }

        const delay = Math.min(3000 * reconnectAttempts, 15000);
        console.log(`Reconnecting in ${delay / 1000}s... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        setTimeout(() => connectWhatsApp(onMessage), delay);
      }

      if (connection === 'open') {
        reconnectAttempts = 0;
        const me = currentSock.user;
        if (me?.id) {
          myPhoneJid = jidNormalizedUser(me.id);
          console.log(`✅ WhatsApp bot connected! myJid=${myPhoneJid}`);
        } else {
          console.log('✅ WhatsApp bot connected!');
        }
      }
    }

    if (events['messages.upsert']) {
      const { messages, type } = events['messages.upsert'];
      if (type !== 'notify') return;

      for (const msg of messages) {
        const jid = msg.key.remoteJid || '';
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

        // Skip groups and status broadcasts
        if (isJidGroup(jid) || isJidStatusBroadcast(jid)) continue;

        // Accept both @s.whatsapp.net and @lid (self-chat uses @lid)
        if (!isPnUser(jid) && !jid.endsWith('@lid')) continue;

        // Skip messages the bot sent (self-chat loop prevention)
        const msgId = msg.key.id || '';
        if (botSentIds.has(msgId)) {
          botSentIds.delete(msgId);
          continue;
        }

        // Skip empty (failed decryptions arrive as empty) — but let voice notes through
        const hasVoiceNote = !!(msg.message?.audioMessage?.ptt);
        if (!text.trim() && !hasVoiceNote) continue;

        console.log(`[MSG] ✅ Processing: ${hasVoiceNote ? '[voice note]' : `"${text.slice(0, 50)}"`} from ${jid}`);
        if (sock === currentSock) {
          try {
            await onMessage(currentSock, msg);
          } catch (err) {
            console.error(`[MSG] Error:`, err);
          }
        }
      }
    }
  });

  return currentSock;
}

export function getSocket(): WASocket | null {
  return sock;
}

export function trackSentMessage(id: string) {
  botSentIds.add(id);
  setTimeout(() => botSentIds.delete(id), 60_000);
}
