import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './src/routes/auth.routes.js';
import videoRoutes from './src/routes/video.routes.js';
import analyticsRoutes from './src/routes/analytics.routes.js';
import viewsRoutes from './src/routes/views.routes.js';
import dashboardRoutes from './src/routes/dashboard.routes.js';
import { notFoundHandler } from './src/middleware/notFound.middleware.js';
import { errorHandler } from './src/middleware/error.middleware.js';
import { connectDatabase } from './src/config/database.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());

const frontendOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (process.env.NODE_ENV !== 'production') {
  for (const local of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
    if (!frontendOrigins.includes(local)) frontendOrigins.push(local);
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || frontendOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
  },
});

app.use('/api', globalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/views', viewsRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'OK',
    data: { status: 'healthy', timestamp: new Date().toISOString() },
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

const start = async () => {
  try {
    if (!process.env.JWT_SECRET) {
      console.warn(
        'Warning: JWT_SECRET is not set. Auth will fail until you add it to .env'
      );
    }

    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Frontend origins: ${frontendOrigins.join(', ')}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

start();

export default app;
