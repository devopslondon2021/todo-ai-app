import { Router } from 'express';
import * as reminderService from '../services/reminderService';
import { getSupabase } from '../config/supabase';

const router = Router();

// GET /api/reminders?user_id=...
router.get('/', async (req, res, next) => {
  try {
    const userId = req.appUserId || (req.query.user_id as string);
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
    const body = req.appUserId ? { ...req.body, user_id: req.appUserId } : req.body;
    const reminder = await reminderService.createReminder(body);
    res.status(201).json({ data: reminder });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reminders/:id — ownership check
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.appUserId) {
      const { data: existing } = await getSupabase()
        .from('reminders')
        .select('user_id')
        .eq('id', req.params.id)
        .single();
      if (!existing || existing.user_id !== req.appUserId) {
        res.status(404).json({ error: 'Reminder not found' });
        return;
      }
    }
    await reminderService.deleteReminder(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
