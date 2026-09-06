import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  getMyWallet,
  updatePaymentMethods,
  requestPayout,
  getMyPayoutHistory,
} from '../controllers/payout.controller.js';

const router = Router();

router.get('/wallet', requireAuth, getMyWallet);
router.patch('/methods', requireAuth, updatePaymentMethods);
router.post('/request', requireAuth, requestPayout);
router.get('/history', requireAuth, getMyPayoutHistory);

export default router;
