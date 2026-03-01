import { Request, Response, NextFunction } from 'express';
import * as userService from '../services/userService';

export async function resolveUser(req: Request, res: Response, next: NextFunction) {
  if (!req.authUserId) {
    // No JWT auth (e.g. Siri API key path) — skip user resolution
    next();
    return;
  }

  try {
    const user = await userService.getOrCreateByAuthId(
      req.authUserId,
      req.authEmail || '',
      req.authMeta,
    );
    req.appUserId = user.id;
    next();
  } catch (err) {
    next(err);
  }
}
