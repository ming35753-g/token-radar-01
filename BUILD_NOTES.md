# token-radar-01 — build notes

Entry for make.fun competition `token-radar-01` ("Build the best token launch radar",
$1,325 total: 1st $1,000, 2nd–5th $50, 6th–10th $25). Entries close
2026-12-14T10:00:00Z (2026-12-14 18:00 CST). Free entry, max 5 submissions/day,
10 total. **Not submitted yet. Nothing here has been pushed to GitHub.**

Built from the kit starter in `../kit/starter/` — model, dashboard and farm
plans are all rewritten; `vendor/makefun-board.ts` and `LICENSE` are the kit's
unchanged files. Snapshot: `as_of` 2026-11-14, 758 protocols, watchlist 40,
floor $50M.

## Model (radar-2, `lib/model.ts`, function `impliedValue`)

One function scores every row from the snapshot's own figures only; no
protocol name is special-cased:

```
implied = round(tvl x peerMultiple(category) x (tvl / $1B)^-0.10
                x growth x maturity x newPenalty x chainMult x wrapPenalty)
```

- **peerMultiple** — shrunk median mcap/TVL of tokenized protocols in the same
  category, `(n*median + 5*global) / (n+5)`, clamped to 0.05x–0.45x. Thin
  categories are capped harder (<3 peers: at most 1.25x the global median
  0.2138x; <5 peers: at most 1.75x). A lending protocol is priced like lending
  protocols that already trade, a DEX like DEXs that already trade.
- **sizeFactor** — sublinear TVL, `(tvl/$1B)^-0.10`: $5M → 1.70, $1B → 1.00,
  $2.75B → 0.90. Size still dominates, but doubling TVL no longer doubles value.
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

Top of the board: #1 Steakhouse Financial $609,116,793 (TVL $2.75B, Risk
Curators, peer 0.2673x from 1 peer); #2 Gauntlet $380,822,189; #3 Veda
$211,663,031. Bottom (#226): $436,312. All 226 values are distinct.

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
- Dashboard (`dashboard/index.html`, `app.css`, `app.js`, 39,105 bytes total,
  dossier text 39,369 / 65,536 bytes so the judge reads the whole source):
  sortable board (rank / name / TVL / 7d / age / peer multiple / implied
  value), filters for search, category, chain and TVL band, pre-token / live
  tabs, a detail drawer per protocol with the full component breakdown
  (the page recomputes the implied value from the stored factors and checks
  it against board.json), a methodology panel with the formula and the peer
  multiples by category, and a "records no token, not proven no token"
  disclaimer. No external URLs anywhere in the dashboard source; no network.
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
| dashboard_files (index.html + css + js, ≤400 files / 4 MiB, no http(s) URLs) | PASS — 3 files, 39,105 B |
| board_file (100–4000 rows, snapshot slugs, non-empty names, positive whole implied values) | PASS — 226 rows |
| sorted_by_value (ranks exactly 1..226, strictly decreasing, not all equal) | PASS — top $609,116,793, bottom $436,312 |
| coverage (every watchlist slug) | PASS — 40/40 |
| farm_steps (3–12 steps, 20–600 chars) | PASS — 6/row, 145–277 chars |
| screenshots (3–4, ≤512 KiB, PNG, long ≤1440, short ≥800) | PASS — 3 × 1440×900, 148–210 KiB |
| dossier_matches (byte-identical rebuild via `buildDossier`) | PASS — 732,733 B (cap 1.5 MiB) |
| dossier text cap | PASS — 39,369 / 65,536 B, source fully included |

Determinism: two consecutive runs produce byte-identical `out/` (`diff -r`
clean), including `dossier.json`.

**grade-local: NOT run.** `node kit/cli/makefun.mjs grade-local --kit kit
--bot ./entry --driver docker` (and `--driver process`) both refuse:
"token-radar-01 is a program/v1 competition: its scorer and reference data
are not published in the kit, so the house grades it from its competition
directory". Docker is also not installed on this machine. The manual gate
script above is the substitute; the sealed scorer only runs on make.fun's
server at submission/dev-grade time.

## What still needs the user (nothing submitted, nothing pushed)

1. **Solana wallet** — the user has no Solana wallet at all. One must be
   created/linked before any USDC payout can be claimed (and, for this
   escrow-funded bounty, an entry must be signed by a linked wallet).
   The user asked for the easiest wallet Muse can use and withdraw from, and
   whether Phantom has any regional restriction — that question is still open
   with the parent agent. **No keypair was created in this build** (per the
   task instructions).
2. **GitHub repo** — create a public repo under `ming35753-g` **after
   2026-11-14** (competition opening), MIT license (already in `entry/`),
   copy `entry/` in (main.ts, lib/, vendor/, dashboard/, screenshots/,
   LICENSE, BUILD_NOTES.md, .gitignore), commit and push. Do **not** include
   `out/` (gitignored) — the grader rebuilds it. Note the snapshot rule: a
   repo whose files are byte-identical to another entrant's earlier submission
   is refused, so this entry must be submitted from the user's own account.
3. **Submission** — submit repo + commit + agent transcripts (bundle) via the
   kit CLI; the transcripts must be the sessions that built this entry.
   Max 5 submissions/day, 10 total; the last before the deadline is final.

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
