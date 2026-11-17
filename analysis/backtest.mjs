// Backtest for the token-radar pricing kernel (model radar-3).
//
// Run:  node analysis/backtest.mjs <snapshot.json>
// (for example: node analysis/backtest.mjs ../kit/input/snapshot.json)
//
// Question: if the market's own pricing of TVL into market cap is the
// ground truth, how well does the model's kernel predict a protocol's
// market cap from its snapshot figures alone?
//
// Population: the snapshot's tokenized protocols with mcap > 0 and TVL > 0
// (128 of 144 tokenized; 16 record mcap 0 and carry no price signal).
// Method: 5-fold cross-validation, folds assigned deterministically by
// slug order (index % 5). For every fold the peer multiples are recomputed
// from the TRAINING folds only, so no test protocol's own ratio leaks into
// its prediction. The entry itself never runs this script: it reads only
// the kit snapshot at grade time, with no network.
//
// Variants (all share the peer-multiple code of lib/model.ts):
//   A  TVL x global median mcap/TVL
//   B  TVL x shrunk category median (the v2 kernel, no size factor)
//   C  B x size factor (tvl / ref)^exponent, exponent swept, ref $1B
//   R  B x size factor (tvl / median peer TVL)^exponent, exponent swept
//      (radar-3: the multiple is the multiple at a typical-size protocol)
//   D  R + growth + maturity + new + chain + wrap (the full radar-3 formula)
// Metrics, out of fold: median |log(pred/actual)| (typical miss as a
// factor), the median log error (bias: positive means the model runs high),
// and the Spearman rank correlation between predicted and actual market
// cap. The script also prints the slope of log(mcap) on log(TVL), pooled
// and within category, and the central-50% band of the full formula's
// holdout errors, which is the typical range the board shows per row.

import { readFileSync } from 'node:fs';

const snap = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const DAY_MS = 86_400_000;

function median(sorted) {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function ageDays(asOf, listedAt) {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
const WRAPPED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
function isWrapped(p) {
  if (p.category !== null && WRAPPED_CATS.has(p.category)) return true;
  return /\b(wrapped|staked|staking)\b/i.test(p.name);
}

/** Peer multiples from a training set, mirroring lib/model.ts. */
function peerMultiples(train, prior = 5) {
  const all = [];
  const byCat = new Map();
  const tvls = [];
  for (const p of train) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    tvls.push(p.tvl_usd);
    const r = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(r) || r <= 0) continue;
    all.push(r);
    const cat = p.category ?? 'Other';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(r);
  }
  all.sort((a, b) => a - b);
  tvls.sort((a, b) => a - b);
  const global = median(all) ?? 0.2;
  const out = new Map();
  for (const [cat, ratios] of byCat) {
    ratios.sort((a, b) => a - b);
    const med = median(ratios) ?? global;
    let m = Math.min(0.45, Math.max(0.05, (ratios.length * med + prior * global) / (ratios.length + prior)));
    if (ratios.length < 3) m = Math.min(m, global * 1.25);
    else if (ratios.length < 5) m = Math.min(m, global * 1.75);
    out.set(cat, { multiple: m });
  }
  return { global, byCategory: out, sizeRef: median(tvls) ?? 1e9 };
}

function factors(p) {
  const g = Math.min(100, Math.max(-50, typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0));
  const age = ageDays(snap.as_of, p.listed_at);
  const ageFor = age ?? 365;
  return {
    growth: g >= 0 ? 1 + (g / 100) * 0.35 : 1 + (g / 100) * 0.55,
    maturity: 0.72 + (Math.min(Math.max(ageFor, 0), 1460) / 1460) * 0.33,
    young: age !== null && age < 30 ? 0.85 : age !== null && age < 90 ? 0.92 : 1,
    chain: 1 + 0.025 * Math.min(Math.max(p.chains.length - 1, 0), 4),
    wrap: isWrapped(p) ? 0.55 : 1,
  };
}

function predict(p, peers, opts) {
  const peer = peers.byCategory.get(p.category ?? 'Other');
  const mult = peer?.multiple ?? Math.min(0.45, Math.max(0.05, peers.global));
  const ref = opts.ref === 'peer' ? peers.sizeRef : 1e9;
  let v = p.tvl_usd * mult * Math.pow(p.tvl_usd / ref, opts.exp);
  if (opts.full) {
    const f = factors(p);
    v *= f.growth * f.maturity * f.young * f.chain * f.wrap;
  }
  return Math.max(1, Math.round(v));
}

function spearman(xs, ys) {
  const rank = (arr) => {
    const order = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const n = xs.length, mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { cov += (rx[i] - mx) * (ry[i] - my); vx += (rx[i] - mx) ** 2; vy += (ry[i] - my) ** 2; }
  return cov / Math.sqrt(vx * vy);
}

const pop = snap.protocols
  .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
  .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
console.log(`population: ${pop.length} tokenized protocols with mcap>0, TVL>0`);

function run(opts, label) {
  const preds = [], actuals = [];
  for (let fold = 0; fold < 5; fold++) {
    const test = pop.filter((_, i) => i % 5 === fold);
    const train = pop.filter((_, i) => i % 5 !== fold);
    const peers = peerMultiples(train);
    for (const p of test) {
      // Variant A prices with the global median alone.
      if (opts.globalOnly) { preds.push(Math.max(1, Math.round(p.tvl_usd * peers.global))); }
      else preds.push(predict(p, peers, opts));
      actuals.push(p.mcap_usd);
    }
  }
  const errs = preds.map((pr, i) => Math.log(pr / actuals[i]));
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const sorted = [...errs].sort((a, b) => a - b);
  const k = Math.floor(preds.length / 10);
  const topPred = new Set(preds.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, i]) => i));
  const topAct = new Set(actuals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, i]) => i));
  let hits = 0;
  for (const i of topPred) if (topAct.has(i)) hits++;
  console.log(`${label.padEnd(46)} med|log| ${median(abs).toFixed(3)} (x${Math.exp(median(abs)).toFixed(2)})  bias ${median(sorted).toFixed(2)}  rho ${spearman(preds, actuals).toFixed(3)}  top-decile ${hits}/${k}`);
  return errs;
}

run({ globalOnly: true }, 'A  TVL x global median');
run({ exp: 0, ref: '1e9' }, 'B  TVL x shrunk category median (v2 kernel)');
for (const e of [-0.1, -0.2, -0.3]) run({ exp: e, ref: '1e9' }, `C  B x size factor (tvl/$1B)^${e}`);
for (const e of [-0.3, -0.35, -0.4]) run({ exp: e, ref: 'peer' }, `R  B x size factor (tvl/median peer TVL)^${e}`);
const fullErrs = run({ exp: -0.35, ref: 'peer', full: true }, 'D  radar-3: R(-0.35) + growth/maturity/chain/wrap');

// The slope of log(market cap) on log(TVL), pooled and within category:
// the model's slope is 1 + exponent, so these two numbers bracket it.
function ols(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxy / sxx, a = my - b * mx;
  const s2 = ys.reduce((s, y, i) => s + (y - (a + b * xs[i])) ** 2, 0) / (n - 2);
  return { b, se: Math.sqrt(s2 / sxx) };
}
const lx = pop.map((p) => Math.log(p.tvl_usd)), ly = pop.map((p) => Math.log(p.mcap_usd));
const pooled = ols(lx, ly);
console.log(`slope log(mcap) ~ log(TVL), pooled: ${pooled.b.toFixed(2)} (SE ${pooled.se.toFixed(3)})`);
const cats = {};
pop.forEach((p, i) => { const c = p.category ?? 'Other'; (cats[c] ??= []).push(i); });
const dx = [], dy = [];
for (const idxs of Object.values(cats)) {
  if (idxs.length < 2) continue;
  const mx = idxs.reduce((s, i) => s + lx[i], 0) / idxs.length, my = idxs.reduce((s, i) => s + ly[i], 0) / idxs.length;
  for (const i of idxs) { dx.push(lx[i] - mx); dy.push(ly[i] - my); }
}
const within = ols(dx, dy);
console.log(`slope log(mcap) ~ log(TVL), within category: ${within.b.toFixed(2)} (SE ${within.se.toFixed(3)})`);

// The typical range: the middle half of the full formula's holdout errors,
// turned into multipliers of the central estimate.
const sorted = [...fullErrs].sort((a, b) => a - b);
const q = (x) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(x * sorted.length)))];
console.log(`full-formula log(pred/actual): p25 ${q(0.25).toFixed(2)} p50 ${q(0.5).toFixed(2)} p75 ${q(0.75).toFixed(2)}`);
console.log(`typical range: implied x [${Math.exp(-q(0.75)).toFixed(2)}, ${Math.exp(-q(0.25)).toFixed(2)}] holds the middle half of holdout outcomes`);
console.log(`within 4x of the prediction: ${fullErrs.filter((e) => Math.abs(e) <= Math.log(4)).length}/${fullErrs.length}`);
