export const HOUSE_FEE_RATE = 0.25;
export const CURVE_MIN_ODDS = 1.0;
export const CURVE_MAX_ODDS = 15.0;
export const CURVE_GAMMA = 2.5;
export const MAX_ADMIN_WEIGHT = 1_000_000_000;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function splitStake(grossStake) {
  const gross = Math.max(0, Math.floor(Number(grossStake || 0)));
  const effectiveStake = Math.floor(gross * (1 - HOUSE_FEE_RATE));
  return {
    grossStake: gross,
    effectiveStake,
    feeAmount: gross - effectiveStake,
  };
}

export function curveOdds(pricingShare) {
  const share = clamp(Number(pricingShare || 0), 0, 1);
  return CURVE_MIN_ODDS +
    (CURVE_MAX_ODDS - CURVE_MIN_ODDS) * Math.pow(1 - share, CURVE_GAMMA);
}

export function marketQuote(candidateEffectivePool, totalEffectivePool, adminWeight = 0) {
  const candidate = Math.max(0, Number(candidateEffectivePool || 0));
  const total = Math.max(0, Number(totalEffectivePool || 0));
  const weight = Math.max(0, Number(adminWeight || 0));

  const userShare = total > 0 ? candidate / total : 0;
  const naturalOdds = candidate > 0 && total > 0 ? total / candidate : Infinity;

  // Weight is candidate-local: increasing it can only lower this candidate's quote.
  // It does not dilute or raise another candidate's quote.
  const pricingDenominator = total + weight;
  const pricingShare = pricingDenominator > 0 ? (candidate + weight) / pricingDenominator : 0;
  const curvedOdds = curveOdds(pricingShare);

  // Critical house-safety invariant:
  // final odds never exceed parimutuel natural odds, so winner payout
  // cannot exceed the total effective pool.
  const decimalOdds = Number.isFinite(naturalOdds)
    ? Math.max(CURVE_MIN_ODDS, Math.min(naturalOdds, curvedOdds))
    : curvedOdds;

  return {
    userShare,
    share: userShare,
    pricingShare,
    naturalOdds: Number.isFinite(naturalOdds) ? naturalOdds : null,
    curveOdds: curvedOdds,
    decimalOdds,
    profitMultiplier: Math.max(0, decimalOdds - 1),
  };
}

export function requiredPricingWeight(candidateEffectivePool, totalEffectivePool, targetOdds) {
  const candidate = Math.max(0, Number(candidateEffectivePool || 0));
  const total = Math.max(0, Number(totalEffectivePool || 0));
  const target = clamp(Number(targetOdds || CURVE_MAX_ODDS), CURVE_MIN_ODDS, CURVE_MAX_ODDS);

  if (total <= 0) return 0;

  // 1.00:1 is the asymptote; approximate it with a share very close to 1.
  const desiredShare = target <= CURVE_MIN_ODDS
    ? 0.999999
    : 1 - Math.pow(
        (target - CURVE_MIN_ODDS) / (CURVE_MAX_ODDS - CURVE_MIN_ODDS),
        1 / CURVE_GAMMA,
      );

  if (desiredShare <= 0) return 0;
  if (desiredShare >= 1) return MAX_ADMIN_WEIGHT;

  const raw = (desiredShare * total - candidate) / (1 - desiredShare);
  return clamp(Math.ceil(Math.max(0, raw)), 0, MAX_ADMIN_WEIGHT);
}
