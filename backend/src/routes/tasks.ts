import { Router } from 'express';
import * as taskService from '../services/taskService';
import * as aiService from '../services/aiService';
import * as categoryService from '../services/categoryService';
import { apiKeyAuth } from '../middleware/apiKeyAuth';

const router = Router();

/** Get the end of the current week (Friday 23:59:59 local) as ISO string */
function getEndOfWeekDefault(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const daysUntilFriday = day <= 5 ? 5 - day : 6; // If Sat, next Fri is 6 days
  const friday = new Date(now);
  friday.setDate(now.getDate() + daysUntilFriday);
  friday.setHours(23, 59, 59, 0);
  return friday.toISOString();
}

// GET /api/tasks?user_id=...&category_id=...&priority=...&status=...
router.get('/', async (req, res, next) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }
    const tasks = await taskService.getTasks({
      user_id: userId,
      category_id: req.query.category_id as string | undefined,
      priority: req.query.priority as any,
      status: req.query.status as any,
      due_date_from: req.query.due_date_from as string | undefined,
      due_date_to: req.query.due_date_to as string | undefined,
      search: req.query.search as string | undefined,
    });
    res.json({ data: tasks });
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/stats?user_id=...
router.get('/stats', async (req, res, next) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }
    const stats = await taskService.getTaskStats(userId);
    res.json({ data: stats });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/parse — AI natural language parsing
router.post('/parse', async (req, res, next) => {
  try {
    const { text, user_id, category_names } = req.body;
    if (!text || !user_id) {
      res.status(400).json({ error: 'text and user_id are required' });
      return;
    }

    const parsed = await aiService.parseNaturalLanguage(text, category_names);

    // Resolve category + subcategory path → category_id
    const category_id = await categoryService.resolveCategoryPath(
      user_id,
      parsed.category,
      parsed.subcategory
    );

    // Apply end-of-week default if no due_date detected
    let due_date = parsed.due_date;
    let due_date_is_default = false;
    if (!due_date) {
      due_date = getEndOfWeekDefault();
      due_date_is_default = true;
    }

    // Check for duplicate tasks
    const duplicates = await taskService.findDuplicates(user_id, parsed.title);

    res.json({
      data: {
        ...parsed,
        category_id,
        due_date,
        due_date_is_default,
        duplicates,
        user_id,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/quick — Siri Shortcuts / external quick-add (API key auth)
router.post('/quick', apiKeyAuth, async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const user = req.apiUser!;

    // 1. Fetch user categories for AI context
    const userCategories = await categoryService.getCategories(user.id);
    const categoryNames = userCategories.map((c) => c.name);

    // 2. AI parse
    const parsed = await aiService.parseNaturalLanguage(text, categoryNames);

    // 3. Resolve category
    const category_id = await categoryService.resolveCategoryPath(
      user.id,
      parsed.category,
      parsed.subcategory
    );

    // 4. Apply end-of-week default if no due_date
    const due_date = parsed.due_date || getEndOfWeekDefault();

    // 5. Create task
    const task = await taskService.createTask({
      user_id: user.id,
      category_id: category_id || undefined,
      title: parsed.title,
      description: parsed.description || undefined,
      priority: parsed.priority,
      due_date,
      reminder_time: parsed.reminder_time || undefined,
      is_recurring: parsed.is_recurring,
      recurrence_rule: parsed.recurrence_rule || undefined,
    });

    // 6. Build human-readable message for Siri
    let message = `Task created: ${parsed.title}`;
    if (parsed.due_date) {
      const d = new Date(parsed.due_date);
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      message += ` — due ${dateStr} ${timeStr}`;
    }
    if (parsed.priority === 'high') message += ' [HIGH]';

    res.status(201).json({ data: { task, message } });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks
router.post('/', async (req, res, next) => {
  try {
    const task = await taskService.createTask(req.body);
    res.status(201).json({ data: task });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/reorder — update sort_order for multiple tasks
router.patch('/reorder', async (req, res, next) => {
  try {
    const { items } = req.body as { items: { id: string; sort_order: number }[] };
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items array is required' });
      return;
    }
    await taskService.reorderTasks(items);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const task = await taskService.updateTask(req.params.id, req.body);
    res.json({ data: task });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await taskService.deleteTask(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
