# BatsBettor — Session Export & Porting Guide

Everything below was built on branch **`claude/determined-hamilton-aoFyA`** of
`kylednguyen/batsbettor`. If this landed in the wrong directory/repo, nothing
is lost — every change is committed and pushed. Use the porting steps at the
bottom to move it where it belongs.

---

## What Was Built (commit by commit)

| Commit | What |
|---|---|
| `be14711` | Model-as-data ML pipeline: Supabase ingestion, JSON model artifact, Node inference |
| `fbca4cf` | Local setup runbook in README + tasks.md |
| `50a8116` | Live win probability trained on past results; live-state predictions in-game |
| `5db5dad` | Odds translation endpoint (win % ↔ book odds) + Phase 4 data roadmap |
| `dd64b31` | Dugout Red design spec + motion layer |
| `a49df5e` | Chatbot appearance refresh (bubbles, composer, send button, chips) |
| `bed9ef6` | LLM output grounding: model provenance rules, no fabricated edges |

---

## Complete File Inventory

### Backend — ML pipeline (new)
```
server/db/supabase.ts                    Supabase client singleton (no-ops if unconfigured)
server/db/schema.sql                     games / odds_snapshots / feature_snapshots / predictions
server/ingest/ingestGames.ts             upsert games; backfill home_win labels at final
server/ingest/ingestOdds.ts              odds snapshot only when the line moves
server/ingest/ingestFeatures.ts          pregame row per game + live-state rows + predictions
server/features/buildFeatureVector.ts    PREGAME features — single source of truth
server/features/buildLiveFeatureVector.ts LIVE features (inning/outs/run diff/bases)
server/features/reconstructLiveStates.ts per-at-bat states from archived play-by-play
server/model/artifact.ts                 JSON artifact contract + validation
server/model/predict.ts                  dual-model inference, devig-v0 fallback, skew tripwire
server/utils/oddsMath.ts                 implied prob, no-vig, fair odds, prob→book translation
scripts/backfill-live-training.ts        npm run backfill:live — instant training data
ml/train_win_prob.py                     trains BOTH artifacts (pregame + live, by-game split)
ml/requirements.txt
.github/workflows/train.yml              weekly cron + manual; commits artifacts
```

### Backend — modified
```
server/liveUpdateHub.ts    ingestion hooked into the 15s tick (failure-isolated)
server/index.ts            + GET /api/predict/:gamePk, /api/model, /api/odds/translate
server/chat.ts             provenance-grounded LLM context (no fake edges/projections)
package.json               + backfill:live, train scripts; --env-file-if-exists=.env
.env.example               + ODDS_API_*, SUPABASE_URL, SUPABASE_SERVICE_KEY
```

### Frontend / docs
```
src/styles.css             Dugout Red tokens, motion layer, chatbot refresh (~400 new lines)
docs/design-spec.md        color/type/elevation/motion spec sheet
tasks.md                   rewritten around model-as-data architecture + runbook
README.md                  full local setup walkthrough
src/data/ingestionLayer.ts DELETED (stale mock)
```

---

## Architecture (one paragraph)

Node service ingests MLB schedule/odds/game-state snapshots into Supabase on
its existing 15s tick. A GitHub Actions job (weekly/manual) trains scikit-learn
logistic regression on those rows and commits a small JSON artifact (coef +
scaler + metadata). Node serves predictions as a dot product from that JSON —
no always-on Python. Two models: pregame (market + records) and live (in-game
state, trained on per-at-bat states reconstructed from past results via
`npm run backfill:live`). Before any training, a `devig-v0` fallback serves the
de-vigged market probability. Two invariants: **leakage rule** (pregame-only
training rows, time/by-game splits) and **skew rule** (one TS feature builder
feeds both training rows and inference; artifact features validated at load).

---

## Porting To The Correct Repo/Directory

Option A — bring the branch over (keeps history):
```bash
cd /path/to/correct-repo
git remote add batsbettor https://github.com/kylednguyen/batsbettor.git
git fetch batsbettor claude/determined-hamilton-aoFyA
git cherry-pick be14711 fbca4cf 50a8116 5db5dad dd64b31 a49df5e bed9ef6
# or: git merge batsbettor/claude/determined-hamilton-aoFyA
```

Option B — copy files (clean slate): copy everything in the inventory above,
then `npm install @supabase/supabase-js` and add the three npm scripts
(`backfill:live`, `train`, and the `--env-file-if-exists=.env` flag on
`dev:server`).

---

## Task List (state after this session)

### Done ✅
- [x] Supabase schema + tick-loop ingestion (games, odds, pregame + live features)
- [x] Single-source-of-truth feature builders (pregame + live)
- [x] Dual-artifact inference with devig-v0 fallback + skew tripwire
- [x] Historical backfill: per-at-bat states from past results
- [x] Training script (both models, leakage-safe splits) + GH Actions workflow
- [x] GET /api/predict/:gamePk, /api/model, /api/odds/translate
- [x] LLM chat grounded in model provenance (no fabricated edges/projections)
- [x] Dugout Red design system + motion layer + chatbot UI refresh
- [x] README + tasks.md runbooks

### Your next steps (in order) ⏳
- [ ] Port to the correct directory/repo (above)
- [ ] Create free Supabase project → run `server/db/schema.sql` in SQL editor
- [ ] Fill `.env`: ANTHROPIC_API_KEY, ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
- [ ] Add SUPABASE_* as GitHub Actions repo secrets
- [ ] `npm run backfill:live -- --start 2026-04-01 --end 2026-06-10` (instant training data)
- [ ] `pip install -r ml/requirements.txt && npm run train`
- [ ] Verify `GET /api/model` reports `lr-<date>` / `lr-live-<date>`
- [ ] Let the server run so pregame snapshots + new labels accumulate

### Later (tasks.md Phases 3-5)
- [ ] `/backtest` endpoint ranking model_versions on identical history
- [ ] "Top edges" frontend tab fed by predictions table
- [ ] Richer features: starter quality, bullpen ERA + fatigue, recent form, park factor (StatsAPI endpoints enumerated in tasks.md Phase 4)
- [ ] Gradient boosting via ONNX export, scored with onnxruntime-web in Node
- [ ] Wire `.value-flash-up/down` + `.pulse-live` CSS hooks into LiveScoreCard/PredictionCard
