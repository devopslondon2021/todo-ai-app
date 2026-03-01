// Prevent unhandled rejections from crashing the process (e.g. async event handlers)
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import taskRoutes from './routes/tasks';
import categoryRoutes from './routes/categories';
import reminderRoutes from './routes/reminders';
import userRoutes from './routes/users';
import settingsRoutes from './routes/settings';
import calendarRoutes from './routes/calendar';
import whatsappRoutes, { handleBotEvent, handleQrStream } from './routes/whatsapp';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/authenticate';
import { resolveUser } from './middleware/resolveUser';

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN.split(',') }));
app.use(express.json());

// Log all incoming requests for debugging
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// Health check (no auth)
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Settings (global, no auth)
app.use('/api/settings', settingsRoutes);

// Auth-protected routes
app.use('/api/tasks', authenticate, resolveUser, taskRoutes);
app.use('/api/categories', authenticate, resolveUser, categoryRoutes);
app.use('/api/reminders', authenticate, resolveUser, reminderRoutes);
app.use('/api/users', authenticate, resolveUser, userRoutes);
app.use('/api/calendar', authenticate, resolveUser, calendarRoutes);
// /api/whatsapp/event — internal bot callback, no auth
app.post('/api/whatsapp/event', handleBotEvent);
// /api/whatsapp/qr-stream — SSE, auth via query param (EventSource can't send headers)
app.get('/api/whatsapp/qr-stream', handleQrStream);
// Other /api/whatsapp/* routes require auth
app.use('/api/whatsapp', authenticate, resolveUser, whatsappRoutes);

// Error handler
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Backend running on port ${env.PORT}`);
  console.log(`Routes: /api/tasks, /api/categories, /api/reminders, /api/users, /api/settings, /api/calendar, /api/whatsapp`);
});
