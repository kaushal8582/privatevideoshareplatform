import User from '../models/User.js';
import ReferralCommission from '../models/ReferralCommission.js';
import { getViewRules } from '../utils/viewRules.js';
import {
  commissionUsdPerPayableView,
  getReferralRules,
  roundUsd,
} from '../utils/referralRules.js';
import { ensureReferralCode } from '../utils/referralCode.js';
import { buildReferralUrl } from '../utils/validators.js';

const periodKey = (date = new Date()) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

/**
 * Resolve referrer from code. Returns null if invalid or self-referral.
 */
export async function resolveReferrer(referralCode, newUserId = null) {
  const code = String(referralCode || '')
    .trim()
    .toUpperCase();
  if (!code || code.length < 4) return null;

  const referrer = await User.findOne({ referralCode: code }).select('_id referralCode status');
  if (!referrer || referrer.status === 'banned') return null;
  if (newUserId && String(referrer._id) === String(newUserId)) return null;
  return referrer;
}

/**
 * Attach referrer on new signup only.
 */
export async function applyReferralOnSignup(newUser, referralCode) {
  const rules = getReferralRules();
  if (!rules.enabled || !referralCode) return null;

  const referrer = await resolveReferrer(referralCode, newUser._id);
  if (!referrer) return null;

  newUser.referredBy = referrer._id;
  newUser.referralAppliedAt = new Date();
  await newUser.save();
  return referrer;
}

/**
 * Model 1: credit referrer bonus when referred user gets a payable view.
 * Referred creator keeps 100% of their earnings.
 */
export async function creditReferralBonus({
  referredUserId,
  videoViewId = null,
}) {
  const referralRules = getReferralRules();
  if (!referralRules.enabled) return;

  const referred = await User.findById(referredUserId).select('referredBy').lean();
  if (!referred?.referredBy) return;

  const viewRules = getViewRules();
  const grossEarningsUsd = roundUsd((1 / 1000) * viewRules.usdPerThousand);
  const commissionUsd = commissionUsdPerPayableView(
    viewRules.usdPerThousand,
    referralRules.commissionRate
  );

  if (commissionUsd <= 0) return;

  const now = new Date();

  await ReferralCommission.create({
    referrer: referred.referredBy,
    referredUser: referredUserId,
    videoView: videoViewId,
    grossEarningsUsd,
    commissionRate: referralRules.commissionRate,
    commissionUsd,
    status: 'pending',
    period: periodKey(now),
  });

  await User.updateOne(
    { _id: referred.referredBy },
    {
      $inc: {
        referralBalanceUsd: commissionUsd,
        referralLifetimeUsd: commissionUsd,
      },
    }
  );
}

export async function getReferralSummary(userId) {
  const user = await User.findById(userId);
  if (!user) return null;

  await ensureReferralCode(user);

  const rules = getReferralRules();
  const viewRules = getViewRules();

  const referredCount = await User.countDocuments({ referredBy: user._id });

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const monthAgg = await ReferralCommission.aggregate([
    {
      $match: {
        referrer: user._id,
        createdAt: { $gte: startOfMonth },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$commissionUsd' },
      },
    },
  ]);

  const thisMonthCommissionUsd = roundUsd(monthAgg[0]?.total || 0);

  return {
    referralCode: user.referralCode,
    referralLink: buildReferralUrl(user.referralCode),
    commissionRate: rules.commissionRate,
    commissionPercent: Math.round(rules.commissionRate * 100),
    referredCount,
    referralBalanceUsd: roundUsd(user.referralBalanceUsd || 0),
    referralLifetimeUsd: roundUsd(user.referralLifetimeUsd || 0),
    thisMonthCommissionUsd,
    usdPerThousand: viewRules.usdPerThousand,
    model: 'bonus',
    modelDescription:
      'Referred creators keep 100% of their earnings. You earn a separate bonus commission.',
  };
}

export async function listReferredUsers(referrerId) {
  const referred = await User.find({ referredBy: referrerId })
    .select('name email payableViews totalAppViews createdAt referralAppliedAt')
    .sort({ createdAt: -1 })
    .lean();

  const viewRules = getViewRules();
  const commissionRate = getReferralRules().commissionRate;

  return referred.map((u) => {
    const payableViews = u.payableViews || 0;
    const estimatedEarningsUsd = roundUsd((payableViews / 1000) * viewRules.usdPerThousand);
    const yourBonusUsd = roundUsd(estimatedEarningsUsd * commissionRate);
    return {
      id: String(u._id),
      name: u.name,
      email: u.email,
      joinedAt: u.createdAt,
      referralAppliedAt: u.referralAppliedAt || u.createdAt,
      payableViews,
      totalAppViews: u.totalAppViews || 0,
      estimatedEarningsUsd,
      yourBonusUsd,
    };
  });
}
