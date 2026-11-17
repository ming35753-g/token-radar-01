// Token Radar model v3 ("radar-3"): one snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) plus the 220 largest pre-token protocols below the floor by TVL.
// A protocol is pre-token when its record carries no token (no market cap, no
// CoinGecko id, no symbol). Live-token protocols are never ranked: they are
// set aside and shown with their market cap, which is a fact, not a model.
//
// Implied value follows only from the snapshot's own figures. No protocol
// name is ever special-cased; the same function scores every row:
//
//   categoryMultiple = shrunk median (mcap / TVL) of TOKENIZED peers in the
//     same category, shrunk toward the global median when a category has few
//     peers: (n * median + 5 * global) / (n + 5), clamped to [0.05, 0.45].
//     A lending protocol is priced like lending protocols that already
//     trade, a DEX like DEXs that already trade, and so on. A category with
//     no tokenized peer at all falls back to the global median.
//   sizeFactor  = (tvl_usd / sizeReference) ^ -0.35, where sizeReference is
//     the median TVL of the tokenized protocols themselves ($32,575,274 in
//     this snapshot). The multiple is what the market pays per dollar of
//     TVL for a typical-size protocol in the category; the size factor
//     scales it by how far this protocol's TVL is from typical. The
//     exponent is fitted, not asserted: a 5-fold holdout on the snapshot's
//     128 tokenized protocols (peer multiples recomputed per fold, so no
//     test protocol's own ratio leaks in) puts the market's slope of
//     log(market cap) on log(TVL) at 0.52 pooled (SE 0.095) and 0.65
//     within category (SE 0.114), so the model's slope 1 + exponent
//     should be 0.52-0.65 and the exponent -0.35 sits between the two
//     estimates, inside the flat optimum (-0.30 to -0.40) of the holdout.
//     The previous -0.10 against a $1B reference over-priced the biggest
//     protocols by 6.5x on median and under-priced the smallest by 2x.
//   growthMult  = 1 + 0.35 * g / 100 for g >= 0, 1 + 0.55 * g / 100 for g < 0,
//     where g = clamp(change_7d, -50, 100). Momentum is dampened (a +100%
//     week is worth +35%, not +50%), and shrinking TVL is penalised harder
//     than growing TVL is rewarded, because a launch priced on a TVL that
//     is leaving is worth less than the same TVL standing still.
//   maturityMult = 0.72 + 0.33 * min(age_days, 1460) / 1460, age unknown = 365.
//     Age is the time since DefiLlama first listed the protocol: the best
//     record of how long it has run with no token. A protocol that has
//     survived four years without a token has a longer record to price on
//     than one listed last month.
//   newPenalty  = 0.85 if age < 30 days, 0.92 if age < 90 days, else 1.
//     Very young protocols are discounted on top of the maturity curve:
//     their TVL has not yet been tested by a market turn.
//   chainMult   = 1 + 0.025 * min(chains - 1, 4), at most 1.10. A protocol
//     live on several chains has more places a token could be useful than
//     a single-chain one, but the bonus is capped so chain-counting cannot
//     outrank TVL.
//   wrapPenalty = 0.55 if the protocol is a wrapped / staked / bridged
//     product (category Bridge, Canonical Bridge, Liquid Staking, Liquid
//     Restaking, Restaked BTC, or a whole word "wrapped"/"staked"/"staking"
//     in its name), else 1. Such a product is a wrapper around a token
//     that already trades, so its own launch is worth far less than a
//     standalone protocol of the same size.
//
//   implied = round(tvl * categoryMultiple * sizeFactor * growthMult
//                     * maturityMult * newPenalty * chainMult * wrapPenalty)
//
// The holdout's honest verdict on the whole formula: the pricing kernel
// (category multiple + size) predicts a tokenized protocol's market cap
// with a typical miss of 3.4x (median |log error| 1.23) and a rank
// correlation of 0.41, and finds 5 of the 12 largest by market cap in its
// top decile against about 1 by chance. The full formula with the
// launch-timing factors runs a typical miss of 3.7x and a rank correlation
// of 0.38: those factors are judgement the brief asks for (growth and age
// are the brief's own inputs, and the watchlist rule itself excludes
// wrapped products), not fitted to market cap, and they cost a little
// market-cap accuracy. The market prices a dollar of TVL over a range
// 1,600x wide (mcap/TVL from 0.00025 to 400 in this snapshot), so no
// TVL-only model can be precise: every row therefore carries a typical
// range, implied x [0.38, 5.6], the band that held the middle half of
// holdout outcomes. A range that wide is the finding, not a failure to
// hide: it is why the board ranks by a central estimate and shows the
// range beside it.
//
// After sorting, implied values are forced strictly decreasing (a tied row
// is lowered by at least 0.1% of the row above it) so the board is a real
// ranking: rank 1 is the most valuable, and no two rows share a value.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight_up: number;
  growth_weight_down: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  size_exponent: number;
  /** Fallback size reference, used only when the snapshot carries no priced protocol; the live reference is the median tokenized TVL, computed in peerMultiples. */
  size_reference_usd: number;
  multiple_floor: number;
  multiple_cap: number;
  shrink_prior: number;
  chain_bonus: number;
  chain_bonus_max: number;
  new_penalty_30d: number;
  new_penalty_90d: number;
  wrap_penalty: number;
}

export const MODEL: ModelConstants = {
  growth_weight_up: 0.35,
  growth_weight_down: 0.55,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.72,
  maturity_range: 0.33,
  maturity_days: 1460,
  unknown_age_days: 365,
  size_exponent: -0.35,
  size_reference_usd: 1_000_000_000,
  multiple_floor: 0.05,
  multiple_cap: 0.45,
  shrink_prior: 5,
  chain_bonus: 0.025,
  chain_bonus_max: 4,
  new_penalty_30d: 0.85,
  new_penalty_90d: 0.92,
  wrap_penalty: 0.55,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/**
 * The holdout backtest the methodology panel reports, measured once on the
 * snapshot's 128 tokenized protocols (5-fold, peer multiples recomputed per
 * fold). See analysis/backtest.mjs, which reproduces every number here
 * from the snapshot alone. `range_low` / `range_high` are the multipliers
 * of the central estimate that held the middle half of holdout outcomes.
 */
export const BACKTEST = {
  folds: 5,
  tokenized_protocols: 128,
  global_only_median_log_error: 1.67,
  category_median_log_error: 1.62,
  v2_median_log_error: 1.39,
  kernel_median_log_error: 1.23,
  full_median_log_error: 1.32,
  kernel_typical_miss: 3.4,
  full_typical_miss: 3.7,
  kernel_spearman: 0.41,
  full_spearman: 0.38,
  top_decile_hits: 5,
  top_decile_total: 12,
  slope_pooled: 0.52,
  slope_pooled_se: 0.095,
  slope_within_category: 0.65,
  slope_within_category_se: 0.114,
  range_low: 0.38,
  range_high: 5.6,
  within_four_x: 65,
}; /** The holdout backtest, as the dashboard reports it. */
export interface BacktestResult {
  folds: number;
  tokenized_protocols: number;
  global_only_median_log_error: number;
  category_median_log_error: number;
  v2_median_log_error: number;
  kernel_median_log_error: number;
  full_median_log_error: number;
  kernel_typical_miss: number;
  full_typical_miss: number;
  kernel_spearman: number;
  full_spearman: number;
  top_decile_hits: number;
  top_decile_total: number;
  slope_pooled: number;
  slope_pooled_se: number;
  slope_within_category: number;
  slope_within_category_se: number;
  range_low: number;
  range_high: number;
  within_four_x: number;
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 220;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 32;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  /** The typical range: the central estimate times the holdout's middle-half band. */
  typical_range_usd: [number, number];
  model: {
    category_multiple: number;
    category_peers: number;
    size_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    new_penalty: number;
    chain_multiplier: number;
    wrap_penalty: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  /** The typical range, in whole dollars, from the holdout's middle-half band. */
  range_low_usd: number;
  range_high_usd: number;
  category_multiple: number;
  category_peers: number;
  size_factor: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  new_penalty: number;
  chain_multiplier: number;
  wrap_penalty: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  /** Median TVL of the tokenized protocols, the size factor's reference point. */
  size_reference_usd: number;
  /** The holdout backtest the methodology panel reports. */
  backtest: BacktestResult;
  peer_multiples: { category: string; peers: number; multiple: number }[];
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Median of a sorted array, or null when empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Category peer multiples: for every category, the shrunk median mcap/TVL of
 * its tokenized protocols, shrunk toward the global median with a prior of
 * `shrink_prior` peers, then clamped. Computed from the snapshot alone.
 * Also returns the size factor's reference: the median TVL of the tokenized
 * protocols, so the peer multiple is the multiple at a typical-size
 * protocol and the size factor measures departure from typical size. When
 * the snapshot carries no priced protocol, the reference falls back to the
 * model's `size_reference_usd`.
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants): { global: number; byCategory: Map<string, { multiple: number; peers: number }>; sizeReference: number } {
  const allRatios: number[] = [];
  const peerTvls: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    peerTvls.push(p.tvl_usd);
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    allRatios.push(ratio);
    const cat = p.category ?? 'Other';
    const list = byCat.get(cat) ?? [];
    list.push(ratio);
    byCat.set(cat, list);
  }
  allRatios.sort((a, b) => a - b);
  peerTvls.sort((a, b) => a - b);
  const global = median(allRatios) ?? 0.2;
  const sizeReference = median(peerTvls) ?? model.size_reference_usd;
  const out = new Map<string, { multiple: number; peers: number }>();
  for (const [cat, ratios] of byCat) {
    ratios.sort((a, b) => a - b);
    const med = median(ratios) ?? global;
    const shrunk = (ratios.length * med + model.shrink_prior * global) / (ratios.length + model.shrink_prior);
    // Thin categories are capped harder: one or two peers, however large
    // their ratios, must not price a whole category at the top of the range.
    let multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk));
    if (ratios.length < 3) multiple = Math.min(multiple, global * 1.25);
    else if (ratios.length < 5) multiple = Math.min(multiple, global * 1.75);
    out.set(cat, { multiple, peers: ratios.length });
  }
  return { global, byCategory: out, sizeReference };
}

/** Whether a protocol is a wrapped / staked / bridged product of a token that already trades. */
export function isWrappedAdjacent(p: SnapshotProtocol): boolean {
  const wrappedCats = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
  if (p.category !== null && wrappedCats.has(p.category)) return true;
  return /\b(wrapped|staked|staking)\b/i.test(p.name);
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

export interface ScoredProtocol {
  p: SnapshotProtocol;
  implied: number;
  categoryMultiple: number;
  categoryPeers: number;
  sizeFactor: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  newPenalty: number;
  chainMult: number;
  wrapPenalty: number;
  age: number | null;
}

/** The typical range around a central estimate, from the holdout's middle-half band. */
export function typicalRange(implied: number): [number, number] {
  return [Math.max(1, Math.round(implied * BACKTEST.range_low)), Math.round(implied * BACKTEST.range_high)];
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  peers: { global: number; byCategory: Map<string, { multiple: number; peers: number }>; sizeReference: number },
): ScoredProtocol {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = growthPct >= 0 ? 1 + (growthPct / 100) * model.growth_weight_up : 1 + (growthPct / 100) * model.growth_weight_down;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const newPenalty = age !== null && age < 30 ? model.new_penalty_30d : age !== null && age < 90 ? model.new_penalty_90d : 1;
  const chainMult = 1 + model.chain_bonus * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_bonus_max);
  const wrapPenalty = isWrappedAdjacent(protocol) ? model.wrap_penalty : 1;
  const sizeFactor = Math.pow(protocol.tvl_usd / peers.sizeReference, model.size_exponent);
  const peer = peers.byCategory.get(protocol.category ?? 'Other');
  const categoryMultiple = peer?.multiple ?? Math.min(model.multiple_cap, Math.max(model.multiple_floor, peers.global));
  const categoryPeers = peer?.peers ?? 0;
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * categoryMultiple * sizeFactor * growthMult * maturityMult * newPenalty * chainMult * wrapPenalty),
  );
  return { p: protocol, implied, categoryMultiple, categoryPeers, sizeFactor, growthPct, growthMult, maturityMult, newPenalty, chainMult, wrapPenalty, age };
}

/** The scored protocols and the board rows built from them. */
export function buildScored(snapshot: Snapshot, model: ModelConstants = MODEL): { scored: ScoredProtocol[]; board: BoardRow[] } {
  const peers = peerMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => impliedValue(p, snapshot.as_of, model, peers));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Force a real ranking: no two rows share an implied value. A tied row is lowered by at least
  // 0.1% of the row above it (at least $1), which is small against the values involved.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied >= scored[i - 1]!.implied) {
      scored[i]!.implied = Math.max(1, scored[i - 1]!.implied - Math.max(1, Math.floor(scored[i - 1]!.implied * 0.001)));
    }
  }
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    typical_range_usd: typicalRange(s.implied),
    model: {
      category_multiple: round4(s.categoryMultiple),
      category_peers: s.categoryPeers,
      size_factor: round4(s.sizeFactor),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      new_penalty: s.newPenalty,
      chain_multiplier: round4(s.chainMult),
      wrap_penalty: s.wrapPenalty,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { scored, board };
}

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly decreasing implied values. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  return buildScored(snapshot, model).board;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open, so the loan book counts your address as an active lender.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in the pair the pool's own page lists first, and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares, so the vault counts your address as a depositor.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app, so the transfer is tied to your address.`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged trade, then close it only after a week.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one market position on an outcome that settles after at least a week, so the position stays open.`;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('curator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares, so the curator's allocation counts your address as a depositor.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the same wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} through ${name} and hold it for the full qualifying window.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full qualifying window.`;
  if (c.includes('basis trading')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open through one funding cycle.`;
  if (c.includes('indexes')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it in the same wallet.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open, so the protocol counts your address as an active user.`;
}

/** A second, complementary action for the same protocol: a different chain or a different verb. */
function secondActionFor(p: SnapshotProtocol, capital: number): string {
  const second = secondChainOf(p);
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (second !== null) {
    return `Repeat the same position on ${second} with $${Math.max(25, Math.floor(capital / 2))} of USDC, so the protocol sees your address active on two of its chains instead of one.`;
  }
  if (c.includes('lend') || c.includes('cdp')) return `Borrow a small amount, about $${Math.max(20, Math.floor(capital / 5))}, against your ${name} supply and repay it within a week, so the protocol counts a borrow as well as a supply.`;
  if (c.includes('dex') || c.includes('yield')) return `Swap a small amount, about $${Math.max(20, Math.floor(capital / 5))}, through ${name}'s own router, so the protocol counts a swap as well as a liquidity position.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Place one more small trade on ${name} in the opposite direction, so the protocol counts two trades from your address in the same week.`;
  return `Use ${name}'s own app once more, for example a swap, a vote or a second deposit, so the protocol counts more than one kind of action from your address.`;
}

/** The weekly qualifying action, by category. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Make one qualifying action each week: top up the supply, adjust the borrow, or claim and re-supply any rewards ${name} pays.`;
  if (c.includes('dex') || c.includes('yield')) return `Make one qualifying action each week: add a little liquidity, collect and re-deposit fees, or swap a small amount through ${name}.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Make one qualifying action each week: open or close one small trade on ${name}, and never leave the account idle for a whole week.`;
  if (c.includes('prediction')) return `Make one qualifying action each week: place one new market position on ${name} on an outcome that is still open.`;
  if (c.includes('bridge')) return `Make one qualifying action each week: bridge a small amount through ${name} or use the bridged funds in its app.`;
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote on ${name}.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * Nothing here promises a token or an airdrop: the protocol records no token, and a launch, if it
 * ever comes, is the protocol's decision, not this board's.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet on ${chain} that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: action, cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: secondActionFor(p, capital), cost: `about $${capital >= 150 ? 4 : 2} of gas`, time: '10 minutes' },
    { text: weeklyActionFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from its own site and claim only from the link it publishes; never pay anyone to claim, and never trust a link sent to you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000 : null,
    }));
}

/** A scored row's compact form for data.js, with the farm plan generated in the page.
 *  The factors are carried at full precision (unlike board.json's rounded
 *  model block) so the page's recomputation of the implied value is exact;
 *  the implied value carried is the final, tie-broken one from the board. */
export function radarRow(s: ScoredProtocol, rank: number): RadarRow {
  return {
    rank,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    age_days: s.age,
    implied_value_usd: s.implied,
    range_low_usd: typicalRange(s.implied)[0],
    range_high_usd: typicalRange(s.implied)[1],
    category_multiple: s.categoryMultiple,
    category_peers: s.categoryPeers,
    size_factor: s.sizeFactor,
    growth_multiplier: s.growthMult,
    maturity_multiplier: s.maturityMult,
    new_penalty: s.newPenalty,
    chain_multiplier: s.chainMult,
    wrap_penalty: s.wrapPenalty,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, scored } = buildScored(snapshot, model);
  const peers = peerMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const peerList = [...peers.byCategory.entries()]
    .map(([category, v]) => ({ category, peers: v.peers, multiple: round4(v.multiple) }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(peers.global),
    size_reference_usd: peers.sizeReference,
    backtest: BACKTEST,
    peer_multiples: peerList,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: scored.map((s, i) => radarRow(s, i + 1)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
