export const HOUSE_EDGE = 0.06;
export const MIN_DECIMAL_ODDS = 1.05;
export const MAX_DECIMAL_ODDS = 8.0;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function oddsFromShare(share) {
  const p = Math.max(0, Number(share || 0));
  if (!p) return MAX_DECIMAL_ODDS;
  const raw = (1 - HOUSE_EDGE) / p;
  return clamp(raw, MIN_DECIMAL_ODDS, MAX_DECIMAL_ODDS);
}

export function marketQuote(candidatePool, totalPool) {
  const pool = Math.max(0, Number(candidatePool || 0));
  const total = Math.max(0, Number(totalPool || 0));
  const share = total > 0 ? pool / total : 0;
  const decimalOdds = oddsFromShare(share);
  return {
    share,
    decimalOdds,
    profitMultiplier: Math.max(0, decimalOdds - 1),
  };
}
