# token-radar-01 — build notes

Entry for make.fun competition `token-radar-01` ("Build the best token launch radar",
$1,325 total: 1st $1,000, 2nd–5th $50, 6th–10th $25). Entries close
2026-12-14T10:00:00Z (2026-12-14 18:00 CST). Free entry, max 5 submissions/day,
10 total. **v1 (radar-2, commit 06946fa) was submitted 2026-11-17 16:16 CST
(submission 01a1e894). This is the radar-3 revision, built to beat it; it is
not submitted yet — the parent agent bundles and submits.**

Built from the kit starter in `../kit/starter/` — model, dashboard and farm
plans are all rewritten; `vendor/makefun-board.ts` and `LICENSE` are the kit's
unchanged files. Snapshot: `as_of` 2026-11-14, 758 protocols, watchlist 40,
floor $50M.

## Model (radar-3, `lib/model.ts`, function `impliedValue`)

One function scores every row from the snapshot's own figures only; no
protocol name is special-cased:

```
implied = round(tvl x peerMultiple(category) x (tvl / medianPeerTVL)^-0.35
                x growth x maturity x newPenalty x chainMult x wrapPenalty)
```

- **peerMultiple** — shrunk median mcap/TVL of tokenized protocols in the same
  category, `(n*median + 5*global) / (n+5)`, clamped to 0.05x–0.45x. Thin
  categories are capped harder (<3 peers: at most 1.25x the global median
  0.2138x; <5 peers: at most 1.75x). A lending protocol is priced like lending
  protocols that already trade, a DEX like DEXs that already trade.
- **sizeFactor** — `(tvl / medianPeerTVL)^-0.35`, where medianPeerTVL is the
  median TVL of the tokenized protocols themselves ($32,575,274 in this
  snapshot). The multiple is what the market pays per dollar of TVL for a
  typical-size protocol; the size factor scales it by distance from typical.
  Both the exponent and the reference are fitted, not asserted (see Backtest
  below). The v2 form, `(tvl/$1B)^-0.10`, over-priced the biggest protocols
  by 6.5x on median and under-priced the smallest by 2x.
- **growth** — dampened momentum, `clamp(change_7d, -50, +100)`; +35% per +100%
  week, −55% per −100% week (shrinking TVL is penalised harder than growing
  TVL is rewarded).
- **maturity** — `0.72 + 0.33 * min(age_days, 1460) / 1460`; unknown age = 365d.
  Age is days since DefiLlama first listed the protocol.
- **newPenalty** — 0.85 if age < 30d, 0.92 if age < 90d, else 1.
- **chainMult** — 1 + 0.025 per extra chain, capped at 4 extra chains (max 1.10).
- **wrapPenalty** — 0.55 for wrapped/staked/bridged products (Bridge, Canonical
  Bridge, Liquid Staking, Liquid Restaking, Restaked BTC categories, or a whole
  word wrapped/staked/staking in the name), else 1.
- After sorting, implied values are forced **strictly decreasing** (a tied row
  is lowered by ≥0.1% of the row above) so the board is a real ranking.
- **Typical range** — every row carries `typical_range_usd`, the central
  estimate times [0.38, 5.6], the band that held the middle half of holdout
  outcomes (see Backtest). The dashboard shows it beside the implied value
  in the detail drawer.

Top of the board: #1 Steakhouse Financial $142,633,371 (TVL $2.75B, Risk
Curators, peer 0.2673x from 1 peer); #2 Gauntlet $102,500,968; #3 Veda
$57,100,148. The v2 top 10 kept its order almost exactly (only #6–#8
shuffled); the fix re-centred the absolute values, it did not scramble the
ranking. Bottom (#226): Valdora Finance $468,880. All 226 values are distinct.

## Backtest (measured, not asserted — `analysis/backtest.mjs`)

5-fold cross-validation over the snapshot's 128 tokenized protocols with
mcap > 0 and TVL > 0 (16 tokenized protocols record mcap 0 and carry no
price signal). Folds are assigned by slug order; peer multiples are
recomputed on each training fold, so no test protocol's own ratio leaks
into its prediction. Metric: median |log(pred/actual)|, i.e. the typical
miss as a factor. Run `node analysis/backtest.mjs <snapshot.json>` to
reproduce every number below from the snapshot alone.

| Variant | Median |log| | Typical miss | Bias | Spearman |
| --- | --- | --- | --- | --- |
| A: TVL x global median | 1.67 | 5.3x | +0.04 | 0.41 |
| B: TVL x shrunk category median (v2 kernel) | 1.62 | 5.1x | +0.09 | 0.42 |
| C: B x size factor (tvl/$1B)^-0.10 (v2) | 1.39 | 4.0x | +0.46 | 0.42 |
| R: B x size factor (tvl/median peer TVL)^-0.35 (radar-3 kernel) | 1.23 | 3.4x | -0.05 | 0.41 |
| D: R + growth/maturity/new/chain/wrap (radar-3 as published) | 1.32 | 3.7x | -0.39 | 0.38 |

- The size exponent is fitted: the market's slope of log(mcap) on log(TVL)
  is 0.52 pooled (SE 0.095) and 0.65 within category (SE 0.114), so the
  model's slope 1 + exponent should be 0.52–0.65 and -0.35 sits between the
  two estimates, inside the flat optimum (-0.30: 1.25, -0.35: 1.23,
  -0.40: 1.23) of the holdout. Changing -0.10 to -0.15 alone looked better
  by 1.5% and was rejected as fitting noise; the reference-point change is
  what does the work.
- By TVL band, v2's bias ran -0.62 (under 2x) below $25M to +1.87 (over
  6.5x) above $1B; radar-3's bands are centred (bias -0.05 overall).
- The launch-timing factors cost a little market-cap accuracy (3.4x to
  3.7x typical miss, Spearman 0.41 to 0.38) because a token's current market
  cap is not a launch value. They stay: the brief asks for growth and age,
  and the watchlist rule itself excludes wrapped products. The wrap penalty
  on its own cost almost nothing under the new size factor (1.31 vs 1.32).
- Top-decile: 5 of the 12 largest by market cap land in the model's top
  decile, against about 1 by chance, stable across every variant.
- The market prices a dollar of TVL over a 1,600x range (mcap/TVL from
  0.00025 to 400), so no TVL-only model can be precise: the middle half of
  holdout outcomes fell between 0.38x and 5.6x the central estimate, and
  65 of 128 actual market caps fell within 4x of the prediction. That is
  the typical range the board shows, and the methodology panel states all
  of this plainly — including the cost of the judgement factors.

## Board (`out/board.json`, built by `main.ts`)

- **226 rows**: all 40 watchlist slugs + 186 early rows. The 186 are *every*
  rankable pre-token protocol below the $50M floor (210 pre-token below the
  floor minus 24 that are CEX or versioned pools, which `isRankable` excludes)
  — not a top-220 cut; there are no more rankable ones to add.
- Live-token protocols are **not** ranked: the 32 largest by market cap are set
  aside in the dashboard's "Live token" tab with their market caps and
  mcap/TVL ratios — those ratios are the peer multiples the model uses.
- Farm plans: 6 steps per row, 145–277 chars each, derived from each
  protocol's category, chains, TVL and age (main action, second-chain or
  second-verb action, weekly qualifying action, hold period, claim/log step),
  each with a cost and a time. Nothing promises a token or an airdrop.
- Dashboard (`dashboard/index.html`, `app.css`, `app.js`, 44,800 bytes total,
  dossier text 45,064 / 65,536 bytes so the judge reads the whole source):
  sortable board (rank / name / TVL / 7d / age / peer multiple / implied
  value), filters for search, category, chain and TVL band, pre-token / live
  tabs, a detail drawer per protocol with the full component breakdown
  (the page recomputes the implied value from the stored factors and checks
  it against board.json), a plain-language reason for the row's value
  (biggest lift and biggest drag, named), the row's typical range, a
  methodology panel with the formula, the peer multiples by category and
  the holdout backtest (numbers included), and a "records no token, not
  proven no token" disclaimer. No external URLs anywhere in the dashboard
  source; no network.
- The dashboard's `farmSteps` / `impliedOf` in `app.js` were verified to
  reproduce `board.json` exactly: 0 implied-value mismatches (>0.2%) and
  0 farm-step mismatches across all 226 rows.

## Screenshots (`screenshots/`, rendered in headless Chromium)

| File | View | Size | Dimensions |
| --- | --- | --- | --- |
| `1-board.png` | Full board, top 5 | 153,628 B | 1440×900 |
| `2-detail.png` | Detail drawer, rank #1 Steakhouse Financial | 214,207 B | 1440×900 |
| `3-filtered.png` | Category filter Dexs, 20 rows shown | 151,325 B | 1440×900 |

Rendered with Playwright's Chromium headless shell (installed to
`~/.cache/ms-playwright/` for this build only; the bundled meta-Chromium
refused to start — "Hatch WebGL domain policy is required" — and `apt-get
update` hung, so it was killed). The first render of `3-filtered.png` came
out byte-identical to `2-detail.png` because a same-document hash navigation
does not reload the page and the detail dialog stayed open; it was re-shot
using the real filter controls, and all three images were visually checked.

## Gate checks (manual — see below for grade-local)

Run: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/input/snapshot.json`
then `node /tmp/gatecheck.mjs` (script kept outside the repo, in /tmp).

| Check | Result |
| --- | --- |
| dashboard_files (index.html + css + js, ≤400 files / 4 MiB, no http(s) URLs) | PASS — 3 files, 44,800 B |
| board_file (100–4000 rows, snapshot slugs, non-empty names, positive whole implied values) | PASS — 226 rows, every row carries `typical_range_usd` |
| sorted_by_value (ranks exactly 1..226, strictly decreasing, not all equal) | PASS — top $142,633,371, bottom $468,880 |
| coverage (every watchlist slug) | PASS — 40/40 |
| farm_steps (3–12 steps, 20–600 chars) | PASS — 6/row, 145–277 chars |
| screenshots (3–4, ≤512 KiB, PNG, long ≤1440, short ≥800) | PASS — 3 × 1440×900, 148–210 KiB (re-rendered for radar-3 below) |
| dossier_matches (byte-identical rebuild via `buildDossier`) | PASS — 738,468 B (cap 1.5 MiB) |
| dossier text cap | PASS — 45,064 / 65,536 B, source fully included |

Determinism: two consecutive runs produce byte-identical `out/` (`diff -r`
clean), including `dossier.json`.

**grade-local: NOT run.** `node kit/cli/makefun.mjs grade-local --kit kit
--bot ./entry --driver docker` (and `--driver process`) both refuse:
"token-radar-01 is a program/v1 competition: its scorer and reference data
are not published in the kit, so the house grades it from its competition
directory". Docker is also not installed on this machine. The manual gate
script above is the substitute; the sealed scorer only runs on make.fun's
server at submission/dev-grade time.

## What still needs the parent agent (this build does not submit)

1. **Push** — commit this radar-3 revision to `ming35753-g/token-radar-01`
   on main (repo already exists, public, MIT). Do **not** include `out/`
   (gitignored) — the grader rebuilds it.
2. **Submission** — bundle the sessions that built this revision with the
   kit CLI and submit repo + commit + bundle. Max 5 submissions/day,
   10 total; the last before the 2026-12-14 deadline is final. The v1
   submission (01a1e894) stays live until this one supersedes it.
   **No keypair was created in this build** (per the task instructions);
   signing uses the agent wallet already connected.

## Gaps / known limitations

- Board is 226 rows, not 260: only 186 rankable pre-token protocols exist
  below the floor (the other 24 are CEX/versioned). Adding more rows would
  mean ranking wrapped/staked/versioned products the watchlist rule
  deliberately excludes.
- Screenshot sizes are 148–210 KiB each, below the 300–350 KiB target in the
  task brief — that target is a dossier-budget guideline, not a gate rule;
  all three pass the ≤512 KiB gate and the dossier is 733 KiB of the 1.5 MiB
  cap. Padding them would add no information for the judge.
- Peer multiples for thin categories are capped by construction (see model);
  e.g. Risk Curators has only 1 tokenized peer, so its multiple is capped at
  1.25× the global median (0.2673x). If that single peer is an outlier, the
  whole category inherits the cap — a deliberate, documented trade-off.
- No dev-grade / judge score exists yet: the judge only runs on make.fun's
  server after submission.
