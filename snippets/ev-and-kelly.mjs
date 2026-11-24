// Excerpt from Outrider (src/lib/ev.mjs). Shown for illustration only.
// The full source code is available at https://store.mikodes.com/p/outrider/
//
// The entry decision as pure maths: expected value after every cost (fees, slippage, price
// impact, tips, failed transactions, rug risk), a fractional-Kelly stake, and a loop that
// shrinks the stake until the expected value clears the bar, or declines the trade.

// Per-side price impact for a constant-product pool: stake vs the quote-side reserve (≈ liquidity / 2).
export function impactPct(stakeUsd, liquidityUsd) {
  // Unknown or non-positive depth (0, negative, string, NaN) → the 100 % worst case, so impact is never negative and
  // never flatters EV or paper fills.
  const liq = Number(liquidityUsd);
  if (!(liq > 0) || !Number.isFinite(liq)) return 100;
  const stake = Number(stakeUsd);
  return Number.isFinite(stake) ? (Math.max(0, stake) / (liq / 2)) * 100 : 100;
}

/**
 * Expected value per unit staked.
 * EV = p·W − (1−p)·L − p_rug·extra − costs, where costs = fees + slippage + impact (both sides)
 * + tips and failed transactions as a share of the stake.
 */
export function expectedValue({ p, pRug, stakeSol, solUsd, liquidityUsd, ev }) {
  const stakeUsd = stakeSol * solUsd;
  const impact = impactPct(stakeUsd, liquidityUsd) / 100;
  const sideCost = ev.feePct / 100 + ev.extraSlippagePct / 100 + impact;
  const txCost = (2 * ev.tipSol * (1 + ev.failedTxRate)) / Math.max(stakeSol, 1e-9);
  const costs = 2 * sideCost + txCost;
  const value = p * ev.avgWin - (1 - p) * ev.avgLoss - pRug * ev.rugExtraLoss - costs;
  return { ev: value, costs, impact };
}

// Kelly for a bet that wins W or loses L of the stake: f* = p/L − q/W.
export function kellyStake({ p, bankrollSol, ev }) {
  // Kelly is undefined for avgLoss 0 (f = +Infinity) or a negative avgLoss/avgWin (a signed journal stat) → no stake.
  if (!(ev.avgLoss > 0) || !(ev.avgWin > 0) || !(p > 0) || !(bankrollSol > 0)) return 0;
  const f = p / ev.avgLoss - (1 - p) / ev.avgWin;
  if (f <= 0) return 0;
  const stake = ev.kellyFraction * f * bankrollSol;
  return Math.min(stake, (ev.maxPerTokenPct / 100) * bankrollSol);
}

// Size, then check EV at that size (impact grows with size, so shrink until EV clears or give up).
export function decide({ p, pRug, bankrollSol, solUsd, liquidityUsd, ev }) {
  let stake = kellyStake({ p, bankrollSol, ev });
  for (let i = 0; i < 6 && stake >= ev.minStakeSol; i++) {
    const r = expectedValue({ p, pRug, stakeSol: stake, solUsd, liquidityUsd, ev });
    if (r.ev >= ev.minEv) return { enter: true, stakeSol: stake, ...r };
    stake /= 2;
  }
  const r = expectedValue({ p, pRug, stakeSol: Math.max(stake, ev.minStakeSol), solUsd, liquidityUsd, ev });
  return { enter: false, stakeSol: 0, ...r };
}
