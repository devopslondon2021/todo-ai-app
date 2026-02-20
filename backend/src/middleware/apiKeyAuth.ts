import { Request, Response, NextFunction } from 'express';
import * as userService from '../services/userService';
import type { User } from '../types';

// Extend Express Request to include the authenticated user
declare global {
  namespace Express {
    interface Request {
      apiUser?: User;
    }
  }
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer todoai_xxx' });
    return;
  }

  const apiKey = authHeader.slice(7); // Remove "Bearer "

  if (!apiKey.startsWith('todoai_')) {
    res.status(401).json({ error: 'Invalid API key format' });
    return;
  }

  try {
    const user = await userService.getUserByApiKey(apiKey);
    if (!user) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    req.apiUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}
