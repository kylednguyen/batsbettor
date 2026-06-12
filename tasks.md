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

# Implementation Status

> This section tracks what is **actually built** vs. the original plan below. It is the source of truth for current state; the rest of this document is the original design brief.

## Architecture as built (diverged from the plan)

The plan proposed Python/FastAPI + Postgres. The app was instead built on a **TypeScript/Node** stack, and the ML runs **in-process in Node** (no separate Python service, no database) — everything is computed live from MLB StatsAPI with in-memory caches.

- **Frontend:** React + Vite + TypeScript (`src/`)
- **Backend:** Node + Express + Socket.IO + TypeScript (`server/`)
- **Data:** MLB StatsAPI (live feed, schedules, history, box scores, pitcher stats); DraftKings scraped for odds, The Odds API fallback
- **No Postgres** — stateless; caching only. (DB can be added later if persistence is needed.)

## Done

**Ingestion & odds**
- [x] Live schedule + game feed + scorecards (`server/mlbStatsService.ts`)
- [x] WebSocket live scoreboard/game updates (`server/liveUpdateHub.ts`)
- [x] DraftKings moneyline scraper, matched by team nickname (`server/draftkingsService.ts`); The Odds API fallback
- [x] Odds math: American↔implied, vig removal, fair odds, edge (`server/oddsMath.ts`)

**Models**
- [x] Analytic **live win-probability** + projected score: base/out run expectancy + remaining innings, normal run-diff, market/prior blend that decays through the game — **incl. extra-innings / ghost-runner handling** (`server/winProbability.ts`)
- [x] Trained **pregame model**: XGBoost (Python) + logistic baseline (TS), on last-10/30 team form; exported as a tree ensemble and run in-process in TS with verified parity (`ml/train_xgb.py`, `server/xgbModel.ts`, `server/pregameModel.ts`, `scripts/train_win_prob.ts`)
- [x] **Team form** feature, last-10 and last-30 (`server/teamForm.ts`)
- [x] **Probable starter** pipeline: ERA/FIP/K9/BB9 → expected runs allowed (`server/pitcherService.ts`)
- [x] **Bullpen fatigue** pipeline: recent reliever pitch load, back-to-back arms, fatigue score (`server/bullpenService.ts`)
- [x] Starter + bullpen integrated as a bounded, explainable **prior adjustment** (only when no market odds, to avoid double-counting) (`server/predictionService.ts`)

**API**
- [x] `GET /api/predict/:gamePk` — full grounded prediction (win prob, projected score, fair odds, no-vig, edge, form, starters, bullpen, confidence, drivers, warnings)
- [x] `GET /api/mlb/*` (schedule, scorecards, game feed, odds), `GET /api/health`, `POST /api/chat`

**Chatbot / LLM — routed MLB assistant** (`server/llm/`)
- [x] Intent router (`intentRouter.ts`) — classifies each question: scoreboard, player, game_summary, model, odds, props, explanation, leaders, general
- [x] Real-data context per mode (`mlbContext.ts`):
  - [x] Today's scoreboard — one hydrated schedule call (not a feed per game)
  - [x] Game summary — box-score top performers + decisions + scoring plays
  - [x] Player stat lines over a time range — today (live box score), this week / last N days / last N games / season — via StatsAPI player search + gameLog / byDateRange / season
  - [x] Sabermetrics — WAR, wRC+, wOBA on season lines; WAR leaderboard (AL/NL, hitting/pitching) for MVP / Cy Young projection
  - [x] Grounded win-probability prediction for model / odds / explanation questions
- [x] Curated baseball **knowledge base** + dependency-free TF-IDF retrieval for concept questions (`baseballKnowledge.ts`, `rag.ts`)
- [x] Routed system prompt — answer baseball first and scannable; model mode separates most-likely-winner from best-value bet; declines individual-player futures; anti-hallucination guardrails
- [x] Swappable provider via `LLM_PROVIDER`: **Groq** / **Gemini** (free hosted), **Anthropic**, or **Ollama** local

**Frontend — ChatGPT-style workspace** (`src/App.tsx`, `src/components/`)
- [x] Stable three-column shell: sidebar | centered chat | attached game-preview panel (no floating pop-outs)
- [x] Sidebar game cards — live / upcoming / final states, live pulse dot, aligned tabular scores, single clean active state
- [x] Centered chat empty state + prompt grid, bottom-anchored composer, markdown answer renderer
- [x] Preview panel — anchored scoreboard (visible across tabs) + Overview / Model / Props / Box Score / Feed tabs
- [x] Model cards separate most-likely-winner from best-value bet; proper base diamond; subtle reduced-motion-safe animations

## Not yet built (next)

- [ ] Player-prop projection model (chat reports props as not modeled yet)
- [ ] Train starter/bullpen into the pregame model (needs historical probable-starter + bullpen backfill); today they apply as a bounded prior adjustment
- [ ] Statcast batter/pitcher quality (xwOBA, barrel, hard-hit, chase/whiff), handedness splits, lineups, injuries, weather/park — not ingested; reported as missing
- [ ] Live odds movement; persistence (Postgres); RAG over historical similar situations
- [ ] Promote Box Score and Feed to top-level preview tabs (currently nested under Overview's sub-views)

## LLM context & data availability

The assistant routes over real data per question (`server/llm/mlbContext.ts`). Available now: today's scoreboard; a game's box-score top performers + scoring plays; player stat lines over today / this week / last N games / season including WAR, wRC+, wOBA; the WAR leaderboard for MVP/Cy Young; and the grounded win-probability prediction (game state, model win prob / projected score / fair odds, recent form, probable starters, bullpen, edge, play-by-play). Still to add — each line notes the source / how to wire it:

**Already fetched — could surface more**
- [x] Box-score top performers and scoring plays (done — game summary mode)
- [x] Play-by-play scoring plays in the prediction context (done)
- [ ] Per-inning linescore (R/H/E) table — `feed.liveData.linescore.innings`
- [ ] Batting order / batters due up — `boxscore.teams.*.battingOrder`; highest-value live add

**Fetched elsewhere, not yet in chat context**
- [ ] Probable-starter recent form / pitch counts in the model context
- [ ] Named bullpen arms / closer availability

**Not yet fetched — needs new ingestion**
- [ ] Statcast batter/pitcher quality (xwOBA, xERA, barrel, hard-hit, chase, whiff) — Baseball Savant via `pybaseball`
- [ ] Handedness / platoon splits — Savant or StatsAPI splits endpoint
- [ ] Injuries & roster moves — StatsAPI `team/{id}/roster` + `transactions`
- [ ] Weather & park factors — Open-Meteo + a static park-factor table
- [ ] Live odds movement — persist odds snapshots over time
- [ ] Player props — player game logs + matchup + prop line + a projection model

> Guardrail stays intact: anything not in the context is reported as missing, never invented.

## Maps to the plan

The 10-Day Build Plan (Days 1–9) and the MVP Scope below are essentially **complete** in the TS architecture. "Day 1" Postgres/Docker is intentionally **not** done (stateless design). Phase 2's "Bullpen fatigue + starting pitcher strength" is **done** as runtime features (training them in is the next step).

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

Data still left out of the win probability models, and where to pull it.
All of it comes from the free MLB StatsAPI — add to the feature builders,
backfill/accumulate, retrain (the artifact tripwire forces the retrain).

```text
STARTING PITCHER QUALITY (pregame + live models)
[ ] Probable starters      GET /api/v1/schedule?hydrate=probablePitcher
[ ] Season pitching stats  GET /api/v1/people/{id}/stats?stats=season&group=pitching
    → ERA, WHIP, K/9, BB/9, innings per start
[ ] Recent form            stats=gameLog → last 3 starts ERA / pitch counts

BULLPEN FEATURES (the big omission)
[ ] Bullpen season stats   GET /api/v1/teams/{id}/stats?group=pitching
    minus starters → bullpen ERA, WHIP, K%
[ ] Bullpen fatigue        boxscores from the last 3 days
    (GET /api/v1.1/game/{pk}/feed/live per recent game) → relief innings
    thrown per team over 1/3/5 days → fatigue score
[ ] Live bullpen state     current feed boxscore → which relievers already
    used tonight; starter pitch count (liveData.boxscore pitchersFaced/pitches)

TEAM RECENT FORM
[ ] Last 10/30 game runs scored & allowed
    GET /api/v1/schedule?teamId=...&startDate=...&endDate=... finals

GAME CONTEXT
[ ] Park factor            static lookup table by venue (publicly published)
[ ] Home/away splits       team stats endpoint with sitCodes
[ ] Rest/travel            derive from schedule (games on consecutive days)

MODEL UPGRADE PATH
[ ] Fit GradientBoosting/XGBoost in Python, export to ONNX with preprocessing
[ ] Score with onnxruntime-web in Node (same predictions contract)
```

Note the leakage rule applies to every new feature: pregame features must be
snapshotted before first pitch; live features must reflect only the state at
that at-bat (e.g. "relievers used so far tonight" is fine, "total relievers
used in the game" is not).

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

---

# Original Expanded Scope (pregame feature wishlist)

```text
1. Team hitting profile
- Recent team batting performance over last 5, 10, 15, and 30 games
- Runs scored, wRC+, OPS, OBP, SLG
- Strikeout rate, walk rate, chase rate, contact rate
- Performance vs pitcher handedness
- Performance at home vs away
- Recent injuries or missing starters if available

2. Player hitting profile
- Projected starting lineup
- Individual batter stats
- Chase rate
- Whiff rate
- Strikeout rate
- Walk rate
- Hard-hit rate
- Barrel rate
- xBA, xSLG, xwOBA if available
- Splits vs right-handed and left-handed pitchers
- Recent form over last 7, 14, and 30 days

3. Starting pitcher profile
- Probable starter for each team
- ERA, WHIP, FIP, xFIP, SIERA if available
- Strikeout rate, walk rate, ground-ball rate
- Hard-hit rate allowed
- Barrel rate allowed
- Pitch count trends
- Innings per start
- Recent starts
- Splits vs left-handed and right-handed batters
- Performance by pitch type if available

4. Bullpen strength
- Bullpen ERA, WHIP, FIP
- Bullpen strikeout and walk rates
- Recent workload over the last 1, 3, 5, and 7 days
- Which relievers are likely unavailable because of recent usage
- Probable high-leverage bullpen arms
- Closer availability
- Setup man availability
- Bullpen fatigue score
- Expected bullpen quality if the starter exits early

5. Game context
- Ballpark factor
- Weather if available
- Wind speed and direction
- Temperature
- Umpire tendencies if available
- Travel/rest advantage
- Day game after night game
- Home/away advantage
- Series context

6. Betting/odds context
- Current sportsbook moneyline
- Implied probability from betting odds
- Model probability
- Difference between model probability and implied probability
- Fair odds generated from model probability
- Edge percentage
- Confidence rating

Build the system in modular steps.

Step 1: Data ingestion
Create a plan for collecting data from available sources such as MLB StatsAPI, Baseball Savant, FanGraphs, Baseball Reference, Retrosheet, or other free public data sources. Identify which fields come from which source. Prefer free sources first.

Step 2: Data cleaning
Normalize team names, player IDs, game IDs, dates, handedness, and stat formats. Handle missing data clearly. Create fallback logic when advanced stats are unavailable.

Step 3: Feature engineering
Create features such as:
- Team recent offense score
- Batter discipline score
- Pitcher quality score
- Pitcher vulnerability score
- Bullpen fatigue score
- Bullpen quality score
- Lineup strength score
- Matchup advantage score
- Park/weather adjustment
- Rest/travel adjustment

Step 4: Modeling
Recommend a practical first model. Start simple before advanced modeling. Compare:
- Logistic regression
- Random forest
- Gradient boosting
- XGBoost or LightGBM if available
- Elo-style rating system
- Ensemble model

The first target should be predicting win probability. A secondary target can be projected runs or run differential.

Step 5: Evaluation
Evaluate the model using:
- Accuracy
- Log loss
- Brier score
- ROC-AUC
- Calibration curve
- Profit/loss simulation against closing moneyline
- Backtesting by date so future games are never used to predict past games

Step 6: Output format
For each game, return a structured response like:

Game:
Team A vs Team B

Current state:
Pregame or live game state

Model win probability:
Team A: __%
Team B: __%

Fair odds:
Team A: __
Team B: __

Sportsbook implied probability:
Team A: __%
Team B: __%

Model edge:
Team A: __%
Team B: __%

Key reasons:
1. Starting pitcher advantage
2. Bullpen rest/availability
3. Lineup discipline/chase-rate advantage
4. Recent offensive form
5. Park/weather adjustment

Plain-English explanation:
Give a short explanation that a normal baseball fan can understand.

Confidence:
Low / Medium / High

Warnings:
Mention missing data, uncertain lineups, weather risk, or bullpen uncertainty.

Important constraints:
- Do not hallucinate data.
- If data is missing, say exactly what is missing.
- Prefer explainable features over black-box output.
- Keep the first version simple enough to build as an MVP.
- Make each module testable.
- Write clean code with clear file structure.
- Assume this will eventually be connected to a React frontend and Flask or FastAPI backend.

Now help me build the MVP step by step. Start by proposing the best architecture, folder structure, free data sources, and the first version of the feature set.
```

Recommended first implementation target for this expanded scope:

```text
1. Keep live win probability as the first production model target
2. Add a pregame feature store using free public sources first
3. Build a simple explainable feature set before advanced lineup or bullpen simulation
4. Return structured model outputs plus plain-English reasons and data-quality warnings
```

---

# Similarity + RAG Win Probability Scope

Use this as the working scope for the historical similarity and retrieval-driven version of the system:

```text
Act as an agentic MLB machine learning engineer.

I want to build a win probability model that predicts MLB game outcomes based on similar historical situations.

The system should combine:
1. A traditional ML model for win probability prediction
2. A vector database/RAG system for retrieving similar past game situations
3. An LLM explanation layer that turns the model output into a clear baseball explanation

The goal is not just to predict the winner. The goal is to say:

"Given this current matchup or live game state, what historically similar situations happened before, what was the outcome distribution, and what does that imply about the current win probability?"

Build the system around historical similarity.

Use historical MLB data to create situation snapshots such as:

Pregame snapshots:
- Home team
- Away team
- Probable starters
- Starting pitcher ERA, WHIP, FIP, K%, BB%, innings per start
- Bullpen ERA, WHIP, FIP
- Bullpen rest and recent workload
- Team recent batting form
- Lineup strength
- Batter chase rate, whiff rate, contact rate, K%, BB%, hard-hit rate
- Team performance vs pitcher handedness
- Park factor
- Weather
- Rest/travel situation
- Market odds and implied probability if available

Live-game snapshots:
- Inning
- Top/bottom
- Outs
- Base runners
- Current score
- Run differential
- Pitch count
- Current pitcher
- Bullpen availability
- Leverage index if available
- Batter/pitcher matchup
- Remaining lineup strength
- Home/away
- Pre-game team strength
- Current betting odds if available

For each historical situation, store:
- Structured numeric features for ML training
- A text summary for embedding/vector search
- Final outcome
- Final score
- Win/loss result
- Actual win probability movement if available
- Market odds if available

Use a vector database such as Chroma, FAISS, Pinecone, Supabase Vector, or pgvector.

The vector database should store text representations like:

"Bottom 7th, home team down 1, runners on first and second, one out, strong bullpen available, starter at 94 pitches, opposing bullpen used heavily yesterday, home lineup has strong platoon advantage against right-handed reliever."

When a new game situation comes in:
1. Convert the current situation into the same text format.
2. Embed it.
3. Retrieve the top 20 to 100 most similar historical situations.
4. Summarize what happened in those similar situations.
5. Use the retrieved examples as extra features for the win probability model.

Create similarity-based features such as:
- Similar situation win rate
- Similar situation average run differential
- Similar situation comeback rate
- Similar situation bullpen collapse rate
- Similar situation home team win rate
- Similar situation favorite win rate
- Similar situation average final score
- Similar situation market mispricing rate if odds data exists

Then train a supervised model using both:
A. Normal structured features
B. RAG-derived historical similarity features

Possible models:
- Logistic regression as baseline
- Random forest
- XGBoost or LightGBM
- CatBoost
- Calibrated gradient boosting
- Elo + ML hybrid model

The target should be:
- Pregame model: home team win probability
- Live model: current team win probability from game state

Evaluation should include:
- Log loss
- Brier score
- Calibration curve
- ROC-AUC
- Accuracy
- Backtesting by date
- Profit/loss simulation against sportsbook odds
- Comparison against baseline betting market probabilities

Important:
- Do not let future data leak into past predictions.
- Use time-based train/test split.
- Do not use final game outcome inside the live-game features.
- The vector search should only retrieve historical situations that occurred before the current prediction date.
- The LLM should explain the result, not make up the probability.
- The ML model should produce the probability.
- The RAG layer should provide similar historical context.
- The LLM should cite retrieved similar situations in plain English.

Design the MVP architecture.

I want you to produce:
1. System architecture
2. Folder structure
3. Data schema
4. Feature engineering plan
5. Vector database plan
6. ML training plan
7. Prediction API design
8. Example Python code
9. Example RAG retrieval flow
10. Example response format for the frontend

Keep the first version practical and buildable with free tools.
Use Python, FastAPI or Flask, scikit-learn, pandas, Chroma or FAISS, and a React frontend.
```

Recommended MVP interpretation of this similarity-based scope:

```text
1. Start with one pregame model and one live-state model
2. Store structured snapshots plus short text summaries for every historical situation
3. Use Chroma or FAISS first before moving to managed vector infra
4. Retrieve similar historical situations only from dates before the prediction timestamp
5. Feed retrieved win-rate and comeback-rate aggregates into the supervised model
6. Let the ML model generate the probability, and let the LLM only explain the retrieved context and feature drivers
```

---

# Phase 2 Upgrades

After the MVP works, add ([x] = done, [ ] = not yet):

```text
[x] Starting pitcher quality      (server/pitcherService.ts)
[x] Bullpen fatigue               (server/bullpenService.ts)
[x] Pregame model                 (XGBoost + logistic on team form)
[x] Source-style grounding        (structured context + concept retrieval in chat)
[x] Routed assistant              (intent router + per-mode real-data context)
[x] Player stats over time ranges (today / week / last N games / season, incl. WAR)
[x] WAR leaderboard + MVP/Cy Young projection
[ ] Team offense last 14 days
[ ] Team wRC+
[ ] Park factor
[ ] Weather
[ ] Batter handedness
[ ] Pitcher handedness
[ ] Line movement tracking
[ ] Player prop projections
[ ] LLM function calling
[ ] Conversation memory
```

Best next upgrade after MVP:

```text
Bullpen fatigue + starting pitcher strength  DONE (runtime features)
Next: train them into the pregame model via a historical starter/bullpen backfill.
```

That makes the project feel more baseball-specific and less generic.

---

# Resume Bullets

```text
Built BatsBet, a live MLB assistant (React + TypeScript front end, Node + Express + Socket.IO back end) that routes natural-language questions over real MLB StatsAPI data — scoreboard, player stat lines over arbitrary time ranges (including WAR, wRC+, wOBA), game summaries, MVP/Cy Young projections from the WAR leaderboard, odds explanations, and a win-probability model.

Implemented an intent router and per-mode data layer that fetches only the data each question needs (one hydrated schedule call for the scoreboard, box-score performers and scoring plays for summaries, player search plus game-log/date-range/season stats for player questions), with anti-hallucination guardrails that report missing data instead of inventing it.

Trained an XGBoost pregame win-probability classifier on ~4,800 historical games using rolling last-10/last-30 team form, exported it as a flattened tree ensemble, and ran inference in-process in TypeScript with verified parity; layered an analytic live win-probability and score-projection engine (base/out run expectancy, extra-innings handling) and odds math (vig removal, fair moneylines, model-vs-market edge) on top.

Designed a ChatGPT-style three-column workspace (sidebar, centered chat, attached game-preview panel with an anchored scoreboard and Overview/Model/Props/Box Score/Feed tabs) and a swappable LLM provider seam (Groq, Gemini, Anthropic, or local Ollama) where the model computes every number and the LLM only explains.
```

---

# One-Sentence Portfolio Description

```text
BatsBet is a live MLB assistant that routes natural-language questions over real MLB data — scores, player stats over any time range (including WAR), game summaries, and MVP projections — with a win-probability and betting-value model layered on top that separates the most likely winner from the best value bet.
```
