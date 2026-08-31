import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  convertLink,
  getMyLinks,
  getMyOgEarn,
} from '../controllers/ogEarn.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

const convertLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.OG_EARN_CONVERT_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many convert requests. Please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
  },
});

router.get('/me', requireAuth, getMyOgEarn);
router.get('/links', requireAuth, getMyLinks);
router.post('/convert', requireAuth, convertLimiter, convertLink);

export default router;
