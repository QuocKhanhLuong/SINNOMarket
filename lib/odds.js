export function oddsFromShare(share) {
  const p = Math.max(0, Number(share || 0));
  if (!p) return 0;
  return 1 / p;
}

export function marketQuote(candidatePool, totalPool) {
  const pool = Math.max(0, Number(candidatePool || 0));
  const total = Math.max(0, Number(totalPool || 0));
  const share = total > 0 ? pool / total : 0;
  const decimalOdds = pool > 0 ? total / pool : 0;
  return {
    share,
    decimalOdds,
    profitMultiplier: Math.max(0, decimalOdds - 1),
  };
}
