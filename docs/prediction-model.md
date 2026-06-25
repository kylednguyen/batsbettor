# The prediction model

This documents the **analytic** prediction served at `/api/predict/:gamePk` —
the one the dashboards and chat use. It is a transparent ("white-box") model, on
purpose: every number can be explained, and the projected score, win
probability, fair moneyline, edge, and confidence all derive from **one
consistent chain** rather than being computed on separate tracks.

The trained scikit-learn model is a separate stack (`/api/model/predict`); see
[architecture.md](architecture.md) §4B.

Code: `server/predictionService.ts` (orchestration) and
`server/winProbability.ts` (math).

---

## The chain at a glance

```text
team form + probable starters            (MLB StatsAPI)
        │
        ▼
1. Run environment ─ each team's expected runs
        │            = its offense × the opponent's run prevention
        ▼
2. Projected score ─ projHome, projAway, total, run differential
        │
        ▼
3. Win probability ─ pregame: P(run diff > 0) under a normal model
        │            live:    run-expectancy state model, blended with a
        │                     decaying pregame prior
        ▼
4. Shrink ─────────  pull the pregame win % 30% toward the book's no-vig line
        │
        ▼
5. Fair moneyline ─ from the (shrunk) win %
        │
        ▼
6. Edge ──────────  model win % − book no-vig %   (percentage points)
        │
        ▼
7. Confidence % ──  saturating curve over |edge|   (replaces Low/Med/High)
```

Each step feeds the next, so a game that projects to be won by ~1 run shows a
favorite at ~60%, fair odds around −150, and an edge/confidence that follow from
exactly that — no contradictions between the projected score and the line.

---

## 1. Run environment

`estimateRunEnvironment()` in `predictionService.ts`. Each team's expected runs
is its recent **offense** scaled by how the opponent **suppresses** runs,
multiplicatively around league average (4.4 runs/team/game):

```text
teamRuns = LG × (offense / LG) × (oppPrevention / LG)

  offense        = team's runsForAvg over its last 30 games
  oppPrevention  = opponent's runsAgainstAvg,
                   blended 50/50 with the opposing starter's expectedRA9
```

- `runsForAvg` / `runsAgainstAvg` come from `teamForm.ts` (last-30 results).
- `expectedRA9` comes from `pitcherService.ts` (≈ 0.5·ERA + 0.5·FIP, league-avg
  4.3 fallback) — the starter throws ~half the game, so it refines the
  team-level prevention for tonight specifically.
- Home gets a small home-field run bump (~0.12).
- Each team's number is clamped to **[2.2, 8.0]** so one lopsided input can't
  blow up the projection.

A strong offense facing a weak starter projects above 4.4; a good pitcher
pulls the opponent below it.

---

## 2. Projected score

For a pregame game the projected runs **are** the run-environment estimates
(there is no in-progress half-inning to walk forward). For a live game they are
`currentScore + expectedRemainingRuns`, where the remaining-runs walk uses each
team's matchup-specific per-inning rate (`teamRuns / 9`) plus base/out run
expectancy for the current half-inning.

> **The 4.5–4.5 bug it replaced:** the old code used a flat 0.5 runs/inning for
> every team, so every pregame game projected 4.5–4.5 regardless of the matchup.
> The run environment is what makes projections vary (e.g. NYY @ TOR 4.0–2.9 vs
> MIA @ PIT 5.3–4.5).

---

## 3. Win probability

**Pregame.** The win probability is derived from the projected run
differential — not from the market. The final run differential is modeled as a
normal distribution whose variance scales with the run total:

```text
mean   = projHome − projAway
var    = (projHome + projAway) × RUN_DISPERSION      (dispersion ≈ 1.35)
σ      = sqrt(var)
P(home win) = Φ(mean / σ)                            clamped to [2%, 98%]
```

This is well-calibrated against Pythagorean expectation: a team projected +1.5
runs lands near 67%, matching `RS² / (RS² + RA²)`.

**Live.** `computeWinProbability` estimates each team's remaining runs from the
current base/out state and innings left, models the remaining differential as a
normal, and **blends** the resulting game-state probability with the pregame
prior. The prior's weight decays as the game progresses
(`marketWeight = 1 − fractionComplete`), so early innings lean on the prior and
late innings on the game state.

**Final.** Returns the realized outcome (1/0) and the final score.

---

## 4. Market shrink (regularization)

A 30-game-form run model is noisier than a sportsbook line, so for **pregame**
games with a book line we pull the model's win probability **30% toward the
book's no-vig number**:

```text
finalHomeProb = 0.7 × modelHomeProb + 0.3 × bookNoVigHomeProb     (MARKET_SHRINK = 0.3)
```

This compresses spurious edges while keeping genuine ones, and ranks the board
like a sharp model rather than a hot one. Notes:

- Applied only to the **betting line** (win %, fair odds, edge). The projected
  **score** stays raw — it's the pure run forecast.
- Applied only pregame and only when a book line exists. Live/final games are
  state-driven, not form-driven, and are left untouched.
- `MARKET_SHRINK` is a single constant in `predictionService.ts`, so it's
  trivial to retune against `/api/backtest` if the data says the model deserves
  more or less trust.

Example: PHI @ MIL went from model 75.5% / +19.2 pt edge (raw) to **69.8% /
+13.4 pts** after the shrink.

---

## 5–6. Fair moneyline and edge

- **Fair moneyline** is the (shrunk) win probability converted to American odds
  via `utils/oddsMath` — so the displayed fair line always agrees with the
  displayed win %.
- **Edge** is the model's win probability minus the book's **no-vig**
  probability, in percentage points: `round1((modelProb − bookNoVig) × 100)`.
  The "best value" side is whichever team has the larger positive edge. Top
  Edges ranks by this.

The no-vig probability strips the book's hold (vig) from the posted moneylines
so the comparison is apples-to-apples; see `utils/oddsMath.ts`.

---

## 7. Confidence %

The old Low / Medium / High label is replaced by a **value-conviction %** driven
by the same model-vs-book discrepancy. `edgeConfidencePct()` maps the edge
through a saturating curve:

```text
conf% = round( 100 × (1 − e^(−|edgePts| / 5)) )
```

| Edge (pts) | Confidence |
| --- | --- |
| 1 | 18% |
| 3 | 45% |
| 5 | 63% |
| 8 | 80% |
| 12 | 91% |

Small disagreements read low; larger ones climb and plateau (so no single game
prints 100%). It is `null` when there's no book line to compare against (the
chip renders "—"). The dashboards tier the chip colour off the %:
`≥60 high`, `30–60 medium`, `<30 low`.

---

## Honest caveats

- These are the **analytic** model's edges (recent-form run model vs the
  market), regularized 30% toward the book — not a backtested, calibrated
  betting signal. Treat large edges as the model's opinion, to be validated.
- `/api/backtest` is the tool to validate them: it re-scores history under each
  model version against the market baseline and reports whether the model's
  disagreements actually beat the book's log loss.
- This is an analytics / portfolio model, **not betting advice**.

---

## Where to change things

| To change… | Edit |
| --- | --- |
| How team runs are estimated | `estimateRunEnvironment` / `teamExpectedRuns` in `predictionService.ts` |
| Run-diff → win-prob dispersion | `RUN_DISPERSION` in `winProbability.ts` |
| How hard the line shrinks to the book | `MARKET_SHRINK` in `predictionService.ts` |
| The confidence curve | `edgeConfidencePct` in `predictionService.ts` |
| Live prior decay | `marketWeight` in `winProbability.ts` |
