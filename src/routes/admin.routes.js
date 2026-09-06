import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.middleware.js';
import {
  adminListPayouts,
  adminProcessPayout,
} from '../controllers/payout.controller.js';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/payouts', adminListPayouts);
router.patch('/payouts/:id', adminProcessPayout);

export default router;
