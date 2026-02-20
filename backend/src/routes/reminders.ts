import { Router } from 'express';
import * as reminderService from '../services/reminderService';

const router = Router();

// GET /api/reminders?user_id=...
router.get('/', async (req, res, next) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }
    const reminders = await reminderService.getReminders(userId);
    res.json({ data: reminders });
  } catch (err) {
    next(err);
  }
});

// POST /api/reminders
router.post('/', async (req, res, next) => {
  try {
    const reminder = await reminderService.createReminder(req.body);
    res.status(201).json({ data: reminder });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reminders/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await reminderService.deleteReminder(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
