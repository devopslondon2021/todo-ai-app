import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import taskRoutes from './routes/tasks';
import categoryRoutes from './routes/categories';
import reminderRoutes from './routes/reminders';
import userRoutes from './routes/users';
import settingsRoutes from './routes/settings';
import calendarRoutes from './routes/calendar';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN.split(',') }));
app.use(express.json());

// Routes
app.use('/api/tasks', taskRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/calendar', calendarRoutes);

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Error handler
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Backend running on port ${env.PORT}`);
});
