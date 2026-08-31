import ReferralCommission from '../models/ReferralCommission.js';
import {
  getReferralSummary,
  listReferredUsers,
} from '../services/referral.service.js';
import { roundUsd } from '../utils/referralRules.js';

/**
 * GET /api/referrals/me
 */
export const getMyReferrals = async (req, res, next) => {
  try {
    const summary = await getReferralSummary(req.user.id);
    if (!summary) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
        error: 'NOT_FOUND',
      });
    }

    return res.json({
      success: true,
      message: 'OK',
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/referrals/referred
 */
export const getReferredUsers = async (req, res, next) => {
  try {
    const users = await listReferredUsers(req.user.id);
    return res.json({
      success: true,
      message: 'OK',
      data: { users },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/referrals/commissions?page=1&limit=20
 */
export const getCommissionHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      ReferralCommission.find({ referrer: req.user.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('referredUser', 'name email')
        .lean(),
      ReferralCommission.countDocuments({ referrer: req.user.id }),
    ]);

    return res.json({
      success: true,
      message: 'OK',
      data: {
        items: items.map((row) => ({
          id: String(row._id),
          commissionUsd: roundUsd(row.commissionUsd),
          grossEarningsUsd: roundUsd(row.grossEarningsUsd),
          commissionRate: row.commissionRate,
          status: row.status,
          period: row.period,
          createdAt: row.createdAt,
          referredUser: row.referredUser
            ? {
                id: String(row.referredUser._id),
                name: row.referredUser.name,
                email: row.referredUser.email,
              }
            : null,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};
