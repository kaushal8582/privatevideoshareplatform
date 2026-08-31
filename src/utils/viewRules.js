export const getViewRules = () => ({
  minCountedSeconds: Number(process.env.VIEW_COUNTED_SECONDS) || 5,
  minPayableSeconds: Number(process.env.VIEW_PAYABLE_SECONDS) || 60,
  usdPerThousand: Number(process.env.VIEW_USD_PER_1000) || 1,
});
