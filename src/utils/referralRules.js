export const getReferralRules = () => ({
  enabled: process.env.REFERRAL_ENABLED !== '0',
  commissionRate: Number(process.env.REFERRAL_COMMISSION_RATE) || 0.1,
});

/** Bonus commission per single payable view (Model 1 — does not reduce creator earnings). */
export const commissionUsdPerPayableView = (usdPerThousand, commissionRate) => {
  const gross = (1 / 1000) * usdPerThousand;
  return Math.round(gross * commissionRate * 1_000_000) / 1_000_000;
};

export const roundUsd = (n) => Math.round(Number(n) * 10_000) / 10_000;
