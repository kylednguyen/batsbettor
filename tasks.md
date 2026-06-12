# MLB Live Forecasting Chatbot Project Plan

## Project Goal

Build a chatbot that answers live MLB forecasting questions using real-time game state, sportsbook odds, historical data, and machine learning predictions.

The chatbot should answer questions like:

```text
What is the live win probability for the Yankees game?
What are the fair odds for the Dodgers right now?
Is the book overpricing the Mets?
What is the projected final score for Red Sox vs Rays?
Show me today's best model vs book differences.
```

This is an analytics and machine learning portfolio project, not betting advice.

---

## Core Design: Model-as-Data

A trained model is just data, not a running thing. Training is heavy and rare; inference is cheap and constant. **You never train in the request path.**

```text
                 ┌──────────────────────────────────────────┐
                 │  Node service (existing Express + tick)  │
 MLB StatsAPI ──→│  • 15s tick loop (liveUpdateHub)         │
 The Odds API ──→│  • ingest: games / odds / features ──────┼──→ Supabase Postgres
 Anthropic ─────→│  • inference: p = σ(w·x_scaled + b)      │     games
                 │  • loads models/win_prob_latest.json     │     odds_snapshots
                 └──────────────▲───────────────────────────┘     feature_snapshots
                                │ JSON artifact                   predictions
                                │ (committed to repo)                  │
                 ┌──────────────┴───────────────────────────┐         │
                 │  GitHub Actions (weekly cron / manual)   │←────────┘
                 │  ml/train_win_prob.py · scikit-learn     │  reads labeled
                 │  StandardScaler + LogisticRegression     │  pregame rows
                 └──────────────────────────────────────────┘
```

**Two lifecycles:**

- **Training (offline, occasional).** A GitHub Actions job reads accumulated history from Supabase — pregame feature snapshots joined to game outcomes — fits the model, and commits a small JSON artifact back to the repo. No always-on Python.
- **Inference (online, constant).** The Node service loads the latest coefficients and scores with a dot product. Linear-model inference is arithmetic.

**The model artifact** (`models/win_prob_latest.json`):

```json
{
  "model_version": "lr-2026-06-12",
  "features": ["home_no_vig_prob", "home_team_win_pct", "away_team_win_pct"],
  "scaler": { "mean": [...], "std": [...] },
  "coef": [...], "intercept": -0.13,
  "trained_at": "2026-06-12T10:00:00Z", "n_games": 412, "val_logloss": 0.61
}
```

"Hosting" the model means storing this JSON. Every prediction row is stamped with `model_version`, so retrains stay comparable on identical historical games.

---

## Two Correctness Rules

### 1. Leakage rule
Training rows only use features that existed **before** the outcome, snapshotted at a consistent point: the pregame feature row per game (`feature_snapshots.is_pregame = true`, enforced by a unique index). Use a **time-based** train/validation split, never random — or the backtest lies.

### 2. Skew rule
Training/serving skew happens when features are computed one way in Python at training and re-implemented in JS at inference. Mitigations in place:

- **One feature builder as source of truth**: `server/features/buildFeatureVector.ts` produces both the persisted training rows and the live inference inputs. Python only reads persisted rows; it never recomputes features.
- **Scaler exported with the model**: the artifact carries `mean`/`std`, so scaling at inference matches training exactly.
- **Skew tripwire**: `server/model/predict.ts` validates the artifact's feature list against the builder's `FEATURE_NAMES` at load time and fails loudly on mismatch.

---

## Model Progression

Each tier keeps the same contract — read features, write a versioned `predictions` row — so swapping model tiers never touches the rest of the system.

```text
Tier 0  de-vig formula        no training; market no-vig prob IS the model (devig-v0)  ✅ live
Tier 1  logistic regression   JSON artifact + Node dot product                         ✅ wired
Tier 2  gradient boosting     fit in Python, export to ONNX, run onnxruntime-web in Node
Tier 3  Python service        joblib pickle + dedicated inference box — only at real scale
```

Tier 2 note: a tree ensemble can't be reduced to coefficients you score in JS. ONNX export carries preprocessing inside the graph, so there's nothing to re-implement — it solves skew for free.

---

## File Map (implemented)

```text
server/
  db/supabase.ts                  Supabase client singleton (no-op if unconfigured)
  db/schema.sql                   run once in Supabase SQL editor
  ingest/ingestGames.ts           upsert games each tick; backfill labels at final
  ingest/ingestOdds.ts            snapshot odds only when the line moves
  ingest/ingestFeatures.ts        one pregame feature row per game + prediction
  features/buildFeatureVector.ts  SINGLE source of truth for features
  utils/oddsMath.ts               implied prob, no-vig, fair-odds conversion
  model/artifact.ts               artifact JSON contract + validation
  model/predict.ts                load artifact, dot product, devig-v0 fallback
models/
  win_prob_latest.json            the "hosted" model (created by first training run)
ml/
  train_win_prob.py               reads Supabase, fits LR, writes artifact
  requirements.txt
.github/workflows/train.yml       weekly cron + manual trigger, commits artifact
```

---

## Database Schema (Supabase Postgres)

See `server/db/schema.sql` for the full DDL.

```text
games              game_pk PK, teams, date, status, final_* scores, home_win (label)
odds_snapshots     moneylines + no-vig probs, written only when the line moves
feature_snapshots  one pregame row per game: feature_names[], feature_values[], JSONB
predictions        model_version-stamped probs, fair odds, edge vs book
```

Setup: create a free Supabase project, run `schema.sql` in the SQL editor, set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in `.env` (and as GitHub Actions secrets).

---

## Ingestion (tick-loop hooks, no separate scheduler)

The existing 15-second tick in `server/liveUpdateHub.ts` drives everything:

```text
tick()
  ├─ fetchScoreboard()                 (existing live updates — unchanged)
  ├─ ingestGames(cards, date)          upsert games; label home_win when final
  ├─ ingestOdds(cards)                 insert snapshot only if line moved (hash check)
  └─ ingestFeatures(cards)             first time a game is seen pregame WITH odds:
                                         buildFeatureVector → feature_snapshots row
                                         predictGame → predictions row (version-stamped)
```

Ingestion failures are caught and logged — they never break live updates. Without Supabase env vars, all writers silently no-op.

---

## Training Loop

```text
1. Let the server run — labeled rows accumulate (need ~50+ final games)
2. Trigger .github/workflows/train.yml (manual or weekly cron)
3. ml/train_win_prob.py:
     - last pregame snapshot per game JOIN games.home_win
     - time-based split (most recent 20% = validation)
     - StandardScaler + LogisticRegression
     - report log loss / Brier vs the market-baseline log loss
     - write models/win_prob_<date>.json + win_prob_latest.json
4. Workflow commits the artifact; Node picks it up (5-min refresh)
```

Retrain trigger: weekly cron, or manually after every N new completed games.

---

## Running Locally (Runbook)

Full setup instructions live in `README.md`. Quick reference:

```bash
npm install && cp .env.example .env   # fill in keys
npm run dev:server                    # backend :8787 — tick loop + ingestion auto-start
npm run dev                           # frontend :5173
```

One-time Supabase setup: create a free project, run `server/db/schema.sql` in the SQL editor, put `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in `.env` and in GitHub repo secrets (for the training workflow).

Sanity checks:

```bash
curl localhost:8787/api/model             # devig-v0 until first training run
curl localhost:8787/api/predict/<gamePk>  # prediction (requires ODDS_API_KEY)
```

Backfill live-state training data from past results (no waiting for accumulation):

```bash
npm run backfill:live -- --start 2026-04-01 --end 2026-06-10
# reconstructs per-at-bat states from archived play-by-play; writes labeled
# games + is_pregame=false feature rows (~75 per game)
```

Train manually once ≥50 labeled games exist (backfill satisfies this immediately):

```bash
pip install -r ml/requirements.txt
npm run train   # needs SUPABASE_* in the environment
# fits BOTH artifacts: win_prob_latest.json (pregame) and
# win_prob_live_latest.json (live) — wait ≤5 min, /api/model shows versions
```

Or trigger the "Train win probability model" workflow in the GitHub Actions tab.

Troubleshooting:

```text
"Supabase not configured" in server logs   → env vars missing; ingestion no-ops
No odds / no predictions                   → ODDS_API_KEY missing or quota hit
"artifact features do not match" crash     → feature builder changed since last
                                             train; delete/retrain the artifact
Training prints "Skipping retrain"         → fewer than 50 labeled games so far
```

---

## Testing & Comparison

```text
[x] Tier 0 live: GET /api/predict/:gamePk returns devig-v0 before any training
[ ] Accumulate 2-4 weeks of labeled games in Supabase
[ ] First training run beats / matches market baseline log loss
[ ] Prospective test: let new version run live, score predictions after finals
[ ] /backtest endpoint: re-score identical historical snapshots under multiple
    model_versions and rank by log loss / Brier (Phase 3)
```

The market is a strong baseline — large disagreements with the no-vig probability usually mean the model is wrong, which is itself informative.

---

## Phase Checklists

### Phase 0 — De-vig translation (no training) ✅
```text
[x] oddsMath.ts: implied prob, no-vig, fair-odds conversion
[x] devig-v0 fallback model in predict.ts
[x] GET /api/predict/:gamePk and GET /api/model endpoints
[x] Prediction wired into chat context (server/chat.ts)
```

### Phase 1 — Ingestion + feature store ✅ (code) / ⏳ (data)
```text
[x] Supabase schema (server/db/schema.sql)
[x] ingestGames / ingestOdds / ingestFeatures hooked into tick loop
[x] Single feature builder (buildFeatureVector.ts)
[ ] Create Supabase project + run schema.sql
[ ] Set SUPABASE_URL / SUPABASE_SERVICE_KEY in .env
[ ] Verify rows accumulate in Supabase dashboard
[ ] Let it run until ~50+ games have labels
```

### Phase 2 — Trained LR model ✅ (code) / ⏳ (run)
```text
[x] ml/train_win_prob.py (time-split, scaler, LR, metrics, artifact)
[x] .github/workflows/train.yml (cron + manual, commits artifact)
[x] Node artifact loader with skew tripwire + 5-min refresh
[ ] Add SUPABASE_* secrets to GitHub repo settings
[ ] First successful training run; confirm Node serves lr-* version
```

### Phase 2.5 — Live-state model trained on past results ✅ (code) / ⏳ (run)
```text
[x] Live feature builder (buildLiveFeatureVector.ts): inning, half, outs,
    run diff, total runs, base runners, team win pcts — no odds, so it
    trains purely from historical results
[x] Per-at-bat state reconstruction from archived play-by-play feeds
    (reconstructLiveStates.ts)
[x] Backfill script: npm run backfill:live -- --start ... --end ...
[x] Live snapshot ingestion during games (state-change detection)
[x] Training fits a second artifact (win_prob_live_latest.json) with a
    BY-GAME time split so one game's states never straddle train/validation
[x] Inference routes live games to the live model; falls back to
    pregame/devig when no live artifact exists
[ ] Run the backfill over the season to date (gives training data instantly,
    no waiting for accumulation)
[ ] Train: npm run train — confirm /api/model reports lr-live-<date>
```

### Phase 3 — Backtesting
```text
[ ] GET /api/backtest: re-score historical pregame snapshots under each
    artifact version; report log loss / Brier / calibration per version
[ ] Profit/loss simulation vs closing moneyline
[ ] "Top edges" tab in the frontend fed by predictions table
```

### Phase 4 — Richer features, then gradient boosting via ONNX
```text
[ ] Add features to buildFeatureVector.ts (starting pitcher quality,
    bullpen rest, recent team form, park factor) — accumulate, retrain
[ ] Fit GradientBoosting/XGBoost in Python, export to ONNX with preprocessing
[ ] Score with onnxruntime-web in Node (same predictions contract)
```

### Phase 5 — Python inference service (only at real scale)
```text
[ ] Bring back the dedicated ml box only when models outgrow ONNX-in-Node
    or need always-on scoring
```

---

## MVP Chatbot Scope

The chatbot should answer only these first:

```text
What games are live?
What is the live score?
What is the home team win probability?
What are the current book odds?
What are the no-vig probabilities?
What are the model fair odds?
What is the model vs book difference?
```

Not yet: player props, pitch-level models, Monte Carlo simulation, weather, bullpen fatigue, batter-vs-pitcher matchup engine.

---

## Resume Bullets

```text
Built an MLB forecasting chatbot that answers natural-language questions about
live win probability, sportsbook odds, fair moneyline pricing, and
model-vs-market differences.

Designed a "model-as-data" ML pipeline: Node ingestion writes versioned feature
snapshots to Supabase Postgres, a scheduled GitHub Actions job trains
scikit-learn models offline, and the Node service performs inference from a
committed JSON artifact — eliminating the need for an always-on ML service.

Prevented training/serving skew with a single TypeScript feature builder used
for both training-row persistence and live inference, with artifact-level
feature validation as a load-time tripwire.

Implemented leakage-safe training: pregame-only feature snapshots, time-based
train/validation splits, and model_version-stamped predictions enabling
apples-to-apples backtests across retrains.
```
