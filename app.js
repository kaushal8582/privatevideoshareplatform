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
import referralsRoutes from './src/routes/referrals.routes.js';
import ogEarnRoutes from './src/routes/ogEarn.routes.js';
import telegramRoutes from './src/routes/telegram.routes.js';
import payoutsRoutes from './src/routes/payouts.routes.js';
import adminRoutes from './src/routes/admin.routes.js';
import { notFoundHandler } from './src/middleware/notFound.middleware.js';
import { errorHandler } from './src/middleware/error.middleware.js';
import { connectDatabase } from './src/config/database.js';
import { startTelegramBot, stopTelegramBot } from './src/telegram/telegramBot.js';

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * Behind Nginx / Cloudflare / load balancer, clients send X-Forwarded-For.
 * express-rate-limit needs trust proxy so it can identify real IPs.
 * Set TRUST_PROXY=1 (or hop count) in production .env.
 */
const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv === 'true' || trustProxyEnv === '1') {
  app.set('trust proxy', 1);
} else if (trustProxyEnv && !Number.isNaN(Number(trustProxyEnv))) {
  app.set('trust proxy', Number(trustProxyEnv));
} else if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet());

const frontendOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Always allow local dev origins when not in production
if (process.env.NODE_ENV !== 'production') {
  for (const local of [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ]) {
    if (!frontendOrigins.includes(local)) frontendOrigins.push(local);
  }
}

// If mastplayer.in is allowed, also allow www
for (const origin of [...frontendOrigins]) {
  if (origin === 'https://mastplayer.in' && !frontendOrigins.includes('https://www.mastplayer.in')) {
    frontendOrigins.push('https://www.mastplayer.in');
  }
  if (origin === 'https://www.mastplayer.in' && !frontendOrigins.includes('https://mastplayer.in')) {
    frontendOrigins.push('https://mastplayer.in');
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin / curl / server-to-server
      if (!origin) {
        return callback(null, true);
      }
      if (frontendOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`CORS blocked origin: ${origin}. Allowed: ${frontendOrigins.join(', ')}`);
      }
      return callback(new Error(`CORS not allowed for origin: ${origin}`));
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
app.use('/api/referrals', referralsRoutes);
app.use('/api/og-earn', ogEarnRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/payouts', payoutsRoutes);
app.use('/api/admin', adminRoutes);

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

    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Frontend origins: ${frontendOrigins.join(', ')}`);
    });

    // Start Telegram after Mongo + HTTP are up (API process only; no second mongoose.connect)
    await startTelegramBot();

    const shutdown = async (signal) => {
      console.log(`Received ${signal}, shutting down…`);
      try {
        await stopTelegramBot();
      } catch (err) {
        console.warn('Telegram shutdown error:', err?.message || err);
      }
      server.close(() => {
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 5000).unref();
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

start();

export default app;
