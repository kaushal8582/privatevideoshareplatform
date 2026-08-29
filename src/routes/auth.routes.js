import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  register,
  login,
  googleAuth,
  me,
  updateMe,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many auth attempts. Please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
  },
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/google', authLimiter, googleAuth);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, updateMe);

export default router;
