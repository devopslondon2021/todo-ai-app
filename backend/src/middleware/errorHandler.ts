import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error('[Error]', err.message);

  if (err.message.includes('Supabase not configured') || err.message.includes('not configured')) {
    res.status(503).json({ error: 'Database not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env' });
    return;
  }

  if (err.message.includes('duplicate key')) {
    res.status(409).json({ error: 'Resource already exists' });
    return;
  }

  if (err.message.includes('not found') || err.message.includes('No rows')) {
    res.status(404).json({ error: 'Resource not found' });
    return;
  }

  res.status(500).json({ error: err.message || 'Internal server error' });
}
