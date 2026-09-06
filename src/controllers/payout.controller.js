import User from '../models/User.js';
import PayoutRequest from '../models/PayoutRequest.js';
import {
  getWalletSummary,
  getPayoutMinUsd,
  sanitizePayoutMethods,
  formatPaymentMethods,
  buildPaymentSnapshot,
} from '../services/payout.service.js';
import { roundUsd } from '../utils/ogEarnRules.js';

/**
 * GET /api/payouts/wallet
 */
export const getMyWallet = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to continue.',
        error: 'UNAUTHORIZED',
      });
    }
    const wallet = await getWalletSummary(user);
    return res.json({
      success: true,
      message: 'OK',
      data: {
        wallet,
        paymentMethods: formatPaymentMethods(user),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/payouts/methods
 */
export const updatePaymentMethods = async (req, res, next) => {
  try {
    const patch = sanitizePayoutMethods(req.body || {});
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to continue.',
        error: 'UNAUTHORIZED',
      });
    }

    if (!user.payoutMethods) user.payoutMethods = {};
    if (!user.payoutMethods.bank) user.payoutMethods.bank = {};

    if (patch.upiId !== undefined) user.payoutMethods.upiId = patch.upiId;
    if (patch.upiAccountName !== undefined) {
      user.payoutMethods.upiAccountName = patch.upiAccountName;
    }
    if (patch.bank.accountName !== undefined) {
      user.payoutMethods.bank.accountName = patch.bank.accountName;
    }
    if (patch.bank.accountNumber !== undefined) {
      user.payoutMethods.bank.accountNumber = patch.bank.accountNumber;
    }
    if (patch.bank.ifsc !== undefined) user.payoutMethods.bank.ifsc = patch.bank.ifsc;

    user.markModified('payoutMethods');
    await user.save();

    return res.json({
      success: true,
      message: 'Payment methods updated',
      data: { paymentMethods: formatPaymentMethods(user) },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        error: err.code || 'VALIDATION_ERROR',
      });
    }
    next(err);
  }
};

/**
 * POST /api/payouts/request
 */
export const requestPayout = async (req, res, next) => {
  try {
    const amountUsd = roundUsd(Number(req.body?.amountUsd));
    const method = String(req.body?.method || '').trim().toLowerCase();
    const min = getPayoutMinUsd();

    if (!Number.isFinite(amountUsd) || amountUsd < min) {
      return res.status(400).json({
        success: false,
        message: `Minimum payout is $${min}.`,
        error: 'VALIDATION_ERROR',
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to continue.',
        error: 'UNAUTHORIZED',
      });
    }

    const open = await PayoutRequest.findOne({ user: user._id, status: 'pending' });
    if (open) {
      return res.status(409).json({
        success: false,
        message: 'You already have a pending payout request. Wait until it is processed.',
        error: 'PENDING_EXISTS',
      });
    }

    const wallet = await getWalletSummary(user);
    if (amountUsd > wallet.availableUsd + 1e-9) {
      return res.status(400).json({
        success: false,
        message: `Available balance is only $${wallet.availableUsd.toFixed(2)}.`,
        error: 'INSUFFICIENT_BALANCE',
      });
    }

    const paymentSnapshot = buildPaymentSnapshot(user, method);

    const doc = await PayoutRequest.create({
      user: user._id,
      amountUsd,
      method,
      paymentSnapshot,
      status: 'pending',
    });

    return res.status(201).json({
      success: true,
      message: 'Payout request submitted',
      data: {
        request: formatPayoutRequest(doc),
        wallet: await getWalletSummary(user),
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        error: err.code || 'VALIDATION_ERROR',
      });
    }
    next(err);
  }
};

/**
 * GET /api/payouts/history
 */
export const getMyPayoutHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { user: req.user.id };
    const [items, total] = await Promise.all([
      PayoutRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PayoutRequest.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      message: 'OK',
      data: {
        items: items.map(formatPayoutRequest),
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/payouts
 */
export const adminListPayouts = async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending').toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (['pending', 'paid', 'rejected'].includes(status)) {
      filter.status = status;
    } else if (status !== 'all') {
      filter.status = 'pending';
    }

    const [items, total] = await Promise.all([
      PayoutRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email')
        .lean(),
      PayoutRequest.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      message: 'OK',
      data: {
        items: items.map((doc) => ({
          ...formatPayoutRequest(doc),
          user: doc.user
            ? { id: String(doc.user._id), name: doc.user.name, email: doc.user.email }
            : null,
        })),
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/admin/payouts/:id
 * body: { action: 'pay' | 'reject', note?: string }
 */
export const adminProcessPayout = async (req, res, next) => {
  try {
    const action = String(req.body?.action || '').toLowerCase();
    const note = req.body?.note != null ? String(req.body.note).trim().slice(0, 500) : null;

    if (!['pay', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be pay or reject.',
        error: 'VALIDATION_ERROR',
      });
    }

    const doc = await PayoutRequest.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Payout request not found.',
        error: 'NOT_FOUND',
      });
    }
    if (doc.status !== 'pending') {
      return res.status(409).json({
        success: false,
        message: `Request is already ${doc.status}.`,
        error: 'ALREADY_PROCESSED',
      });
    }

    if (action === 'pay') {
      doc.status = 'paid';
      doc.adminNote = note;
      doc.processedAt = new Date();
      doc.processedBy = req.user.id;
      await doc.save();

      await User.updateOne(
        { _id: doc.user },
        { $inc: { payoutLifetimePaidUsd: doc.amountUsd } }
      );
    } else {
      doc.status = 'rejected';
      doc.adminNote = note || 'Rejected by admin';
      doc.processedAt = new Date();
      doc.processedBy = req.user.id;
      await doc.save();
    }

    return res.json({
      success: true,
      message: action === 'pay' ? 'Marked as paid' : 'Request rejected',
      data: { request: formatPayoutRequest(doc) },
    });
  } catch (err) {
    next(err);
  }
};

function formatPayoutRequest(doc) {
  const snap = doc.paymentSnapshot || {};
  return {
    id: String(doc._id),
    amountUsd: doc.amountUsd,
    method: doc.method,
    status: doc.status,
    paymentSnapshot: {
      upiId: snap.upiId || null,
      accountName: snap.accountName || null,
      accountNumber: snap.accountNumber || null,
      ifsc: snap.ifsc || null,
    },
    adminNote: doc.adminNote || null,
    processedAt: doc.processedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
