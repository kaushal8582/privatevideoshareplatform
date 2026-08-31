export const getOgEarnRules = () => ({
  enabled: process.env.OG_EARN_ENABLED !== '0',
  royaltyRate: Number(process.env.OG_EARN_ROYALTY_RATE) || 0.1,
});

export const roundUsd = (n) => Math.round(Number(n) * 1_000_000) / 1_000_000;
