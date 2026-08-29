import { Router } from 'express';
import { getDashboardStats } from '../controllers/dashboard.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/stats', requireAuth, getDashboardStats);

export default router;
