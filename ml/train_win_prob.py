"""Train the win probability model and emit a JSON artifact.

Reads pregame feature snapshots joined to game outcomes from Supabase, fits
StandardScaler + LogisticRegression with a time-based split, and writes the
model as data: models/win_prob_<date>.json + models/win_prob_latest.json.

The feature rows were produced by server/features/buildFeatureVector.ts at
ingestion time — this script never recomputes features, which is what keeps
training and serving from drifting apart.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python ml/train_win_prob.py
"""

import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.preprocessing import StandardScaler
from supabase import create_client

REPO_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = REPO_ROOT / "models"
MIN_TRAINING_GAMES = 50
VALIDATION_FRACTION = 0.2


def fetch_training_frame(supabase) -> pd.DataFrame:
    """Last pregame snapshot per game, joined to the home_win label."""
    snapshots = []
    page_size = 1000
    offset = 0
    while True:
        result = (
            supabase.table("feature_snapshots")
            .select("game_pk, collected_at, feature_names, feature_values")
            .eq("is_pregame", True)
            .order("collected_at")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        snapshots.extend(result.data)
        if len(result.data) < page_size:
            break
        offset += page_size

    games = []
    offset = 0
    while True:
        result = (
            supabase.table("games")
            .select("game_pk, game_date, home_win")
            .not_.is_("home_win", "null")
            .order("game_date")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        games.extend(result.data)
        if len(result.data) < page_size:
            break
        offset += page_size

    if not snapshots or not games:
        return pd.DataFrame()

    snap_df = pd.DataFrame(snapshots)
    # The unique pregame index should guarantee one row per game; keep the
    # last by collected_at defensively.
    snap_df = snap_df.sort_values("collected_at").groupby("game_pk").last().reset_index()
    games_df = pd.DataFrame(games)

    return snap_df.merge(games_df, on="game_pk", how="inner")


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required", file=sys.stderr)
        return 1

    supabase = create_client(url, key)
    frame = fetch_training_frame(supabase)

    if len(frame) < MIN_TRAINING_GAMES:
        print(f"Only {len(frame)} labeled games available; need {MIN_TRAINING_GAMES}. Skipping retrain.")
        return 0

    feature_names = frame.iloc[0]["feature_names"]
    consistent = frame["feature_names"].apply(lambda names: names == feature_names)
    if not consistent.all():
        dropped = int((~consistent).sum())
        print(f"Dropping {dropped} rows with a different feature schema (older snapshots).")
        frame = frame[consistent]

    X = np.array(frame["feature_values"].tolist(), dtype=float)
    y = frame["home_win"].astype(int).to_numpy()

    # Time-based split: validate on the most recent games, never random.
    frame = frame.sort_values("game_date")
    split = int(len(frame) * (1 - VALIDATION_FRACTION))
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    scaler = StandardScaler().fit(X_train)
    model = LogisticRegression(max_iter=1000).fit(scaler.transform(X_train), y_train)

    val_logloss = None
    val_brier = None
    if len(X_val) > 0 and len(set(y_val)) > 1:
        val_probs = model.predict_proba(scaler.transform(X_val))[:, 1]
        val_logloss = float(log_loss(y_val, val_probs))
        val_brier = float(brier_score_loss(y_val, val_probs))
        # Baseline comparison: the no-vig market probability is feature 0.
        if "home_no_vig_prob" in feature_names:
            idx = feature_names.index("home_no_vig_prob")
            market_probs = np.clip(X_val[:, idx], 0.001, 0.999)
            print(f"Market baseline log loss: {log_loss(y_val, market_probs):.4f}")

    artifact = {
        "model_version": f"lr-{date.today().isoformat()}",
        "features": feature_names,
        "scaler": {"mean": scaler.mean_.tolist(), "std": scaler.scale_.tolist()},
        "coef": model.coef_[0].tolist(),
        "intercept": float(model.intercept_[0]),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_games": int(len(frame)),
        "val_logloss": val_logloss,
        "val_brier": val_brier,
    }

    MODELS_DIR.mkdir(exist_ok=True)
    versioned_path = MODELS_DIR / f"win_prob_{date.today().isoformat()}.json"
    latest_path = MODELS_DIR / "win_prob_latest.json"
    for path in (versioned_path, latest_path):
        path.write_text(json.dumps(artifact, indent=2) + "\n")

    print(f"Trained {artifact['model_version']} on {artifact['n_games']} games")
    print(f"Validation log loss: {val_logloss}, Brier: {val_brier}")
    print(f"Wrote {versioned_path} and {latest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
