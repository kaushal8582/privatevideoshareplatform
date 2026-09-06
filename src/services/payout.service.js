import mongoose from 'mongoose';
import { getViewRules } from '../utils/viewRules.js';
import { roundUsd } from '../utils/ogEarnRules.js';
import PayoutRequest from '../models/PayoutRequest.js';

export function getPayoutMinUsd() {
  const n = Number(process.env.PAYOUT_MIN_USD);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/**
 * Gross lifetime earnings (USD) before payouts.
 * Upload earnings derived from payableViews; OG/referral from stored balances.
 */
export function computeGrossEarningsUsd(user) {
  const rules = getViewRules();
  const payableViews = user.payableViews || 0;
  const uploadEarningsUsd = roundUsd((payableViews / 1000) * rules.usdPerThousand);
  const ogEarnBalanceUsd = roundUsd(user.ogEarnBalanceUsd || 0);
  const ogRoyaltyBalanceUsd = roundUsd(user.ogRoyaltyBalanceUsd || 0);
  const referralBalanceUsd = roundUsd(user.referralBalanceUsd || 0);

  const grossEarnedUsd = roundUsd(
    uploadEarningsUsd + ogEarnBalanceUsd + ogRoyaltyBalanceUsd + referralBalanceUsd
  );

  return {
    uploadEarningsUsd,
    ogEarnBalanceUsd,
    ogRoyaltyBalanceUsd,
    referralBalanceUsd,
    grossEarnedUsd,
    usdPerThousand: rules.usdPerThousand,
  };
}

export async function getWalletSummary(user) {
  const parts = computeGrossEarningsUsd(user);
  const lifetimePaidUsd = roundUsd(user.payoutLifetimePaidUsd || 0);
  const userId = user._id || user.id;
  const matchUser =
    userId instanceof mongoose.Types.ObjectId
      ? userId
      : new mongoose.Types.ObjectId(String(userId));

  const [pendingAgg] = await PayoutRequest.aggregate([
    { $match: { user: matchUser, status: 'pending' } },
    { $group: { _id: null, total: { $sum: '$amountUsd' }, count: { $sum: 1 } } },
  ]);

  const pendingUsd = roundUsd(pendingAgg?.total || 0);
  const pendingCount = pendingAgg?.count || 0;
  const availableUsd = roundUsd(
    Math.max(0, parts.grossEarnedUsd - lifetimePaidUsd - pendingUsd)
  );

  return {
    ...parts,
    lifetimePaidUsd,
    pendingUsd,
    pendingCount,
    availableUsd,
    minPayoutUsd: getPayoutMinUsd(),
  };
}

export function sanitizePayoutMethods(input = {}) {
  const upiId = input.upiId != null ? String(input.upiId).trim().slice(0, 80) : undefined;
  const upiAccountName =
    input.upiAccountName != null
      ? String(input.upiAccountName).trim().slice(0, 80)
      : undefined;
  const bankIn = input.bank && typeof input.bank === 'object' ? input.bank : {};

  const accountName =
    bankIn.accountName != null ? String(bankIn.accountName).trim().slice(0, 80) : undefined;
  const accountNumber =
    bankIn.accountNumber != null
      ? String(bankIn.accountNumber).replace(/\s+/g, '').slice(0, 32)
      : undefined;
  const ifsc =
    bankIn.ifsc != null
      ? String(bankIn.ifsc).trim().toUpperCase().replace(/\s+/g, '').slice(0, 20)
      : undefined;

  const methods = {
    upiId: upiId === undefined ? undefined : upiId || null,
    upiAccountName: upiAccountName === undefined ? undefined : upiAccountName || null,
    bank: {
      accountName: accountName === undefined ? undefined : accountName || null,
      accountNumber: accountNumber === undefined ? undefined : accountNumber || null,
      ifsc: ifsc === undefined ? undefined : ifsc || null,
    },
  };

  if (methods.upiId && !/^[\w.\-]{2,}@[\w.\-]{2,}$/i.test(methods.upiId)) {
    const err = new Error('Enter a valid UPI ID (e.g. name@upi).');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  if (methods.upiId && methods.upiAccountName === null) {
    const err = new Error('Enter the account holder name for UPI.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  if (methods.upiAccountName && methods.upiAccountName.length < 2) {
    const err = new Error('Enter a valid account holder name.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  if (methods.bank.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(methods.bank.ifsc)) {
    const err = new Error('Enter a valid IFSC code.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  if (methods.bank.accountNumber && !/^\d{6,32}$/.test(methods.bank.accountNumber)) {
    const err = new Error('Enter a valid bank account number.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  return methods;
}

export function formatPaymentMethods(user) {
  const m = user.payoutMethods || {};
  const bank = m.bank || {};
  return {
    upiId: m.upiId || null,
    upiAccountName: m.upiAccountName || null,
    bank: {
      accountName: bank.accountName || null,
      accountNumber: bank.accountNumber || null,
      ifsc: bank.ifsc || null,
    },
    hasUpi: Boolean(m.upiId && m.upiAccountName),
    hasBank: Boolean(bank.accountName && bank.accountNumber && bank.ifsc),
  };
}

export function buildPaymentSnapshot(user, method) {
  const methods = formatPaymentMethods(user);
  if (method === 'upi') {
    if (!methods.hasUpi) {
      const err = new Error('Add UPI ID and account holder name before requesting a UPI payout.');
      err.statusCode = 400;
      err.code = 'PAYMENT_METHOD_REQUIRED';
      throw err;
    }
    return {
      upiId: methods.upiId,
      accountName: methods.upiAccountName,
      accountNumber: null,
      ifsc: null,
    };
  }
  if (method === 'bank') {
    if (!methods.hasBank) {
      const err = new Error('Add complete bank details before requesting a bank payout.');
      err.statusCode = 400;
      err.code = 'PAYMENT_METHOD_REQUIRED';
      throw err;
    }
    return {
      upiId: null,
      accountName: methods.bank.accountName,
      accountNumber: methods.bank.accountNumber,
      ifsc: methods.bank.ifsc,
    };
  }
  const err = new Error('Choose payout method: upi or bank.');
  err.statusCode = 400;
  err.code = 'VALIDATION_ERROR';
  throw err;
}
