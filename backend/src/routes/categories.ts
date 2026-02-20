import { Router } from 'express';
import * as categoryService from '../services/categoryService';

const router = Router();

// GET /api/categories?user_id=...
router.get('/', async (req, res, next) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }
    const categories = await categoryService.getCategories(userId);
    res.json({ data: categories });
  } catch (err) {
    next(err);
  }
});

// GET /api/categories/tree?user_id=... — hierarchical tree
router.get('/tree', async (req, res, next) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }
    const tree = await categoryService.getCategoryTree(userId);
    res.json({ data: tree });
  } catch (err) {
    next(err);
  }
});

// POST /api/categories
router.post('/', async (req, res, next) => {
  try {
    const category = await categoryService.createCategory(req.body);
    res.status(201).json({ data: category });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/categories/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const category = await categoryService.updateCategory(req.params.id, req.body);
    res.json({ data: category });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/categories/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await categoryService.deleteCategory(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
