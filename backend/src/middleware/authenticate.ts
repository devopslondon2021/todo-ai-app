import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks && env.SUPABASE_URL) {
    jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  // Let apiKeyAuth handle Siri API keys
  if (token.startsWith('todoai_')) {
    next();
    return;
  }

  const jwksClient = getJwks();
  if (!jwksClient) {
    res.status(503).json({ error: 'Auth not configured — missing SUPABASE_URL' });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, jwksClient, {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
    });

    req.authUserId = payload.sub;
    req.authEmail = payload.email as string | undefined;
    req.authMeta = payload.user_metadata as Record<string, unknown> | undefined;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
