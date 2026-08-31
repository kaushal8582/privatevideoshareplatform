import { Router } from 'express';
import {
  getCommissionHistory,
  getMyReferrals,
  getReferredUsers,
} from '../controllers/referrals.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/me', requireAuth, getMyReferrals);
router.get('/referred', requireAuth, getReferredUsers);
router.get('/commissions', requireAuth, getCommissionHistory);

export default router;
