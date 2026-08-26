import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  uploadVideo,
  getVideos,
  getVideoById,
  getVideoByShareToken,
  deleteVideo,
  healthCheck,
} from '../controllers/video.controller.js';
import { uploadSingleVideo } from '../middleware/upload.middleware.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;

const uploadLimiter = rateLimit({
  windowMs,
  max: Number(process.env.UPLOAD_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many upload requests. Please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
  },
});

const shareLimiter = rateLimit({
  windowMs,
  max: Number(process.env.SHARE_RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
  },
});

const deleteLimiter = rateLimit({
  windowMs,
  max: Number(process.env.DELETE_RATE_LIMIT_MAX) || 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many delete requests. Please try again later.',
    error: 'RATE_LIMIT_EXCEEDED',
  },
});

router.get('/health', healthCheck);

// Public — anyone with the link can watch
router.get('/share/:shareToken', shareLimiter, getVideoByShareToken);

// Owner-only
router.post('/upload', requireAuth, uploadLimiter, uploadSingleVideo, uploadVideo);
router.get('/', requireAuth, getVideos);
router.get('/:id', requireAuth, getVideoById);
router.delete('/:id', requireAuth, deleteLimiter, deleteVideo);

export default router;
