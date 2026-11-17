# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ming35753-g/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ming35753-g/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar ranking 226 pre-token protocols by implied value — all 40 watchlist protocols plus every rankable pre-token protocol below the $50M floor — with a sortable dashboard, per-protocol farm plans, and a methodology panel.

Model radar-3 prices each protocol at its category's shrunk median mcap / TVL, scaled by a size factor whose exponent (-0.35) and reference point (the median tokenized protocol's TVL) are fitted on a 5-fold holdout over the snapshot's own 128 tokenized protocols — the holdout is reproduced by `analysis/backtest.mjs`. Every row carries a typical range (the middle half of holdout outcomes) and a plain-language reason for its value.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=z4yv0914&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
