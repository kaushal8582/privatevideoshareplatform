import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { trackEvent } from '../controllers/analytics.controller.js';

const router = Router();

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.ANALYTICS_RATE_LIMIT_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many analytics events. Please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
  },
});

router.post('/events', analyticsLimiter, trackEvent);

export default router;
