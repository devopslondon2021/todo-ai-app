import { Router, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env';
import { getUserByAuthId } from '../services/userService';
import { getSupabase } from '../config/supabase';

const router = Router();

// Active SSE connections keyed by appUserId
const sseClients = new Map<string, Response>();

// Exported for index.ts — mounted without auth middleware
export async function handleBotEvent(req: Request, res: Response): Promise<void> {
  const { userId, type, data, jid } = req.body;
  if (!userId) {
    res.status(400).json({ error: 'Missing userId' });
    return;
  }
  const client = sseClients.get(userId);
  if (client) {
    const payload: Record<string, unknown> = { type };
    if (data !== undefined) payload.data = data;
    if (jid !== undefined) payload.jid = jid;
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
  res.status(200).json({ received: true });
}

// JWKS for SSE token verification (same pattern as authenticate.ts)
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks && env.SUPABASE_URL) {
    jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

// Exported for index.ts — mounted without auth middleware (EventSource can't send headers)
export async function handleQrStream(req: Request, res: Response): Promise<void> {
  const token = req.query.token as string;
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  const jwksClient = getJwks();
  if (!jwksClient) {
    res.status(503).json({ error: 'Auth not configured' });
    return;
  }

  let appUserId: string;
  try {
    const { payload } = await jwtVerify(token, jwksClient, {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
    });
    const user = await getUserByAuthId(payload.sub as string);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    appUserId = user.id;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.set(appUserId, res);
  req.on('close', () => sseClients.delete(appUserId));
}

// POST /connect — proxy to bot API
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const url = `${env.WHATSAPP_BOT_URL}/connect`;
    console.log(`[WA] POST ${url} userId=${req.appUserId}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: req.appUserId }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error(`[WA] Bot unreachable at ${env.WHATSAPP_BOT_URL}:`, (err as Error).message);
    res.status(503).json({ error: 'Bot service unavailable' });
  }
});

// POST /disconnect — proxy to bot API
router.post('/disconnect', async (req: Request, res: Response) => {
  // Close any open SSE connection for this user
  const client = sseClients.get(req.appUserId!);
  if (client) {
    client.end();
    sseClients.delete(req.appUserId!);
  }
  try {
    const response = await fetch(`${env.WHATSAPP_BOT_URL}/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: req.appUserId }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch {
    res.status(503).json({ error: 'Bot service unavailable' });
  }
});

// GET /status — combined bot status + DB status
router.get('/status', async (req: Request, res: Response) => {
  const userId = req.appUserId!;
  let botStatus: { status?: string } = {};
  let dbStatus: { whatsapp_jid?: string | null; whatsapp_connected?: boolean } = {};

  await Promise.all([
    fetch(`${env.WHATSAPP_BOT_URL}/status?userId=${userId}`)
      .then(r => r.json())
      .then((d: unknown) => { botStatus = d as { status?: string }; })
      .catch(() => {}),
    (async () => {
      try {
        const { data } = await getSupabase()
          .from('users')
          .select('whatsapp_jid, whatsapp_connected')
          .eq('id', userId)
          .single();
        if (data) dbStatus = data;
      } catch {}
    })(),
  ]);

  res.json({
    data: {
      status: botStatus.status ?? (dbStatus.whatsapp_connected ? 'connected' : 'disconnected'),
      jid: dbStatus.whatsapp_jid ?? null,
      connected: dbStatus.whatsapp_connected ?? false,
    },
  });
});

export default router;
