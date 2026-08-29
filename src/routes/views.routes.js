import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { heartbeat } from '../controllers/views.controller.js';
import { optionalAuth } from '../middleware/auth.middleware.js';

const router = Router();

const viewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.VIEW_RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many view heartbeats. Please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
  },
});

router.post('/heartbeat', viewLimiter, optionalAuth, heartbeat);

export default router;
