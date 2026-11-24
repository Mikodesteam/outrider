// Excerpt from Outrider (src/lib/protections.mjs). Shown for illustration only. The full source code is available at https://store.mikodes.com/p/outrider/
//
// Two safety nets for an automated trading desk. The stop-loss guard locks new
// entries after a run of losing stop-outs. The tiered hard stop watches equity
// drawdown from its peak and escalates green, yellow, orange, red, where red
// flattens positions and stays latched until a human clears it.

const MIN = 60000;

// StoplossGuard: N stop-type exits within the lookback → lock all entries until the last of them + duration.
// "pair vanished" (the desk's write-off of a rugged/delisted DEX pair, always −100%) counts as a stop-out, so a run of
// rugs trips the guard. Closes stamped in the future (clock skew) are ignored instead of locking for longer than
// lockMinutes.
const STOP_REASON = /^(stop|rug|profit lock|creator sold|trailing|pair vanished)/;
export function stoplossGuard(closes, now, g) {
  const recent = (closes ?? []).filter((c) => {
    const t = Date.parse(c?.ts);
    return (
      Number.isFinite(t) &&
      t <= now + 10 * MIN &&
      now - t <= g.lookbackMinutes * MIN &&
      STOP_REASON.test(String(c.reason ?? "")) &&
      c.ret < 0
    );
  });
  if (recent.length < g.tradeLimit) return null;
  const until = Math.max(...recent.map((c) => Date.parse(c.ts))) + g.lockMinutes * MIN;
  return until > now ? { until, why: `${recent.length} losing stop-outs in ${g.lookbackMinutes} min` } : null;
}

/**
 * Tiered hard stop on drawdown from the all-time equity peak. score = min(raw, EMA(raw)) so one wick does not trigger
 * it and a stale EMA does not keep it triggered after a recovery.
 * green < 0.5R ≤ yellow (warn) < 0.75R ≤ orange (no new entries) < R ≤ red (flatten, latch until a human clears it).
 */
export function hardStop(state, equity, now, h) {
  // Unknown (non-finite) equity → the tier stands and nothing is updated, so an ORANGE (entries blocked) tier cannot
  // drop to GREEN on a NaN score.
  if (!Number.isFinite(equity) || !Number.isFinite(now)) {
    const tier = state.hsl?.tier ?? "green";
    return { tier, score: state.hsl?.score ?? 0, changed: false };
  }
  const s = (state.hsl ??= { peak: equity, ema: 0, at: now, tier: "green" });
  // Latched: nothing moves until resetHardStop
  if (s.tier === "red") return { tier: "red", score: s.score ?? 1, changed: false };
  // A NaN/null peak (older state, JSON null) or non-positive peak is re-based, so raw never becomes NaN/−∞.
  if (!Number.isFinite(s.peak) || s.peak <= 0) s.peak = Math.max(equity, 0);
  if (!Number.isFinite(s.ema)) s.ema = 0;
  if (!Number.isFinite(s.at)) s.at = now;
  s.peak = Math.max(s.peak, equity);
  const raw = s.peak > 0 ? Math.max(0, 1 - equity / s.peak) : 0;
  const mins = Math.max(0, (now - s.at) / MIN);
  const alpha = Math.min(1, 2 / (Math.max(0, h.emaMinutes) + 1)); // capped at 1: emaMinutes 0 would give alpha 2
  s.ema = raw + (s.ema - raw) * (1 - alpha) ** mins;
  s.at = now;
  const score = Math.min(raw, s.ema);
  const R = h.redPct / 100;
  const prev = s.tier;
  s.score = score;
  s.tier = score >= R ? "red" : score >= 0.75 * R ? "orange" : score >= 0.5 * R ? "yellow" : "green";
  return { tier: s.tier, score, changed: s.tier !== prev };
}
