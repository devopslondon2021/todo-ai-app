import { Router } from 'express';
import { getProvider, setProvider, type AIProvider } from '../config/ai';

const router = Router();

// GET /api/settings
router.get('/', (_req, res) => {
  res.json({
    data: {
      ai_provider: getProvider(),
    },
  });
});

// PUT /api/settings
router.put('/', async (req, res, next) => {
  try {
    const { ai_provider } = req.body;

    if (ai_provider === 'ollama') {
      // Test Ollama connectivity before switching
      try {
        const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const response = await fetch(`${ollamaUrl}/api/tags`);
        if (!response.ok) throw new Error('Ollama not reachable');
      } catch {
        res.status(400).json({ error: 'Ollama is not running or not reachable. Start Ollama first.' });
        return;
      }
    }

    if (ai_provider) setProvider(ai_provider as AIProvider);

    res.json({
      data: {
        ai_provider: getProvider(),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
