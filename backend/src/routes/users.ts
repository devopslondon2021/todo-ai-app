import { Router } from 'express';
import * as userService from '../services/userService';

const router = Router();

// POST /api/users/me — get or create app user from JWT (protected)
router.post('/me', async (req, res, next) => {
  try {
    if (!req.authUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const user = await userService.getOrCreateByAuthId(
      req.authUserId,
      req.authEmail || '',
      req.authMeta,
    );
    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/default — get or create the default user
router.get('/default', async (_req, res, next) => {
  try {
    const user = await userService.getOrCreateDefault();
    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id
router.get('/:id', async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id/api-key — ownership required
router.get('/:id/api-key', async (req, res, next) => {
  try {
    if (req.appUserId && req.appUserId !== req.params.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const apiKey = await userService.getApiKey(req.params.id);
    if (!apiKey) {
      res.status(404).json({ error: 'User not found or no API key' });
      return;
    }
    res.json({ data: { api_key: apiKey } });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/api-key/regenerate — ownership required
router.post('/:id/api-key/regenerate', async (req, res, next) => {
  try {
    if (req.appUserId && req.appUserId !== req.params.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const newKey = await userService.regenerateApiKey(req.params.id);
    res.json({ data: { api_key: newKey } });
  } catch (err) {
    next(err);
  }
});

// POST /api/users
router.post('/', async (req, res, next) => {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).json({ data: user });
  } catch (err) {
    next(err);
  }
});

export default router;
