import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  createConnectCode,
  getDestinations,
  patchDestinationSettings,
  deleteDestination,
  getVideoPublications,
  retryPublication,
} from '../controllers/telegram.controller.js';

const router = Router();

router.post('/connect/code', requireAuth, createConnectCode);
router.get('/destinations', requireAuth, getDestinations);
router.patch('/destinations/:id/settings', requireAuth, patchDestinationSettings);
router.delete('/destinations/:id', requireAuth, deleteDestination);
router.get('/publications/:videoId', requireAuth, getVideoPublications);
router.post('/publications/:id/retry', requireAuth, retryPublication);

export default router;
