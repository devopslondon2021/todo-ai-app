import express from 'express';
import { connectUser, disconnectUser, getSessionStatus } from '../connection/sessionManager.js';

export function startBotApiServer(port: number): void {
  const app = express();
  app.use(express.json());

  app.post('/connect', async (req, res) => {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
    try {
      await connectUser(userId);
      res.json({ status: 'connecting', userId });
    } catch (err: any) {
      console.error('[BOT-API] /connect error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/disconnect', async (req, res) => {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
    try {
      await disconnectUser(userId);
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[BOT-API] /disconnect error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/status', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
    const status = getSessionStatus(userId);
    res.json({ userId, status });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`🤖 Bot API server listening on 0.0.0.0:${port}`);
  });
}
