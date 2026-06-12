"""Train the win probability models and emit JSON artifacts.

Two models, same artifact contract:

  PREGAME — one snapshot per game (is_pregame = true), market + record
            features. Artifact: models/win_prob_latest.json

  LIVE    — per-at-bat game states (is_pregame = false), trained on past
            results: states reconstructed from historical play-by-play
            (scripts/backfill-live-training.ts) plus states captured live by
            the tick loop. Artifact: models/win_prob_live_latest.json

Feature rows were produced by the TypeScript feature builders at ingestion
time — this script never recomputes features, which is what keeps training
and serving from drifting apart.

Leakage rules: time-based splits only, and for the live model the split is
by GAME, never by row — all snapshots of a game share its outcome, so rows
from one game must not straddle train/validation.

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
PAGE_SIZE = 1000


def fetch_all(query):
    rows = []
    offset = 0
    while True:
        result = query.range(offset, offset + PAGE_SIZE - 1).execute()
        rows.extend(result.data)
        if len(result.data) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def fetch_frame(supabase, is_pregame: bool) -> pd.DataFrame:
    snapshots = fetch_all(
        supabase.table("feature_snapshots")
        .select("game_pk, collected_at, feature_names, feature_values")
        .eq("is_pregame", is_pregame)
        .order("snapshot_id")
    )
    games = fetch_all(
        supabase.table("games")
        .select("game_pk, game_date, home_win")
        .not_.is_("home_win", "null")
        .order("game_date")
    )
    if not snapshots or not games:
        return pd.DataFrame()

    snap_df = pd.DataFrame(snapshots)
    if is_pregame:
        # One row per game is the pregame contract; keep the last defensively.
        snap_df = snap_df.sort_values("collected_at").groupby("game_pk").last().reset_index()
    games_df = pd.DataFrame(games)
    return snap_df.merge(games_df, on="game_pk", how="inner")


def split_by_game(frame: pd.DataFrame):
    """Time-ordered split on games so no game's rows straddle the boundary."""
    game_order = (
        frame[["game_pk", "game_date"]]
        .drop_duplicates("game_pk")
        .sort_values(["game_date", "game_pk"])["game_pk"]
        .tolist()
    )
    split = int(len(game_order) * (1 - VALIDATION_FRACTION))
    train_games = set(game_order[:split])
    train_mask = frame["game_pk"].isin(train_games)
    return frame[train_mask], frame[~train_mask]


def train_model(frame: pd.DataFrame, version_prefix: str, artifact_name: str) -> bool:
    n_games = frame["game_pk"].nunique() if len(frame) else 0
    if n_games < MIN_TRAINING_GAMES:
        print(f"[{version_prefix}] Only {n_games} labeled games; need {MIN_TRAINING_GAMES}. Skipping.")
        return False

    feature_names = frame.iloc[0]["feature_names"]
    consistent = frame["feature_names"].apply(lambda names: names == feature_names)
    if not consistent.all():
        print(f"[{version_prefix}] Dropping {int((~consistent).sum())} rows with an older feature schema.")
        frame = frame[consistent]

    train_df, val_df = split_by_game(frame)
    X_train = np.array(train_df["feature_values"].tolist(), dtype=float)
    y_train = train_df["home_win"].astype(int).to_numpy()
    X_val = np.array(val_df["feature_values"].tolist(), dtype=float)
    y_val = val_df["home_win"].astype(int).to_numpy()

    scaler = StandardScaler().fit(X_train)
    model = LogisticRegression(max_iter=1000).fit(scaler.transform(X_train), y_train)

    val_logloss = None
    val_brier = None
    if len(X_val) > 0 and len(set(y_val)) > 1:
        val_probs = model.predict_proba(scaler.transform(X_val))[:, 1]
        val_logloss = float(log_loss(y_val, val_probs))
        val_brier = float(brier_score_loss(y_val, val_probs))
        if "home_no_vig_prob" in feature_names:
            idx = feature_names.index("home_no_vig_prob")
            market_probs = np.clip(X_val[:, idx], 0.001, 0.999)
            print(f"[{version_prefix}] Market baseline log loss: {log_loss(y_val, market_probs):.4f}")

    artifact = {
        "model_version": f"{version_prefix}-{date.today().isoformat()}",
        "features": feature_names,
        "scaler": {"mean": scaler.mean_.tolist(), "std": scaler.scale_.tolist()},
        "coef": model.coef_[0].tolist(),
        "intercept": float(model.intercept_[0]),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_games": int(n_games),
        "n_rows": int(len(frame)),
        "val_logloss": val_logloss,
        "val_brier": val_brier,
    }

    MODELS_DIR.mkdir(exist_ok=True)
    versioned_path = MODELS_DIR / artifact_name.replace("latest", date.today().isoformat())
    latest_path = MODELS_DIR / artifact_name
    for path in (versioned_path, latest_path):
        path.write_text(json.dumps(artifact, indent=2) + "\n")

    print(f"[{version_prefix}] Trained {artifact['model_version']} on {n_games} games / {len(frame)} rows")
    print(f"[{version_prefix}] Validation log loss: {val_logloss}, Brier: {val_brier}")
    print(f"[{version_prefix}] Wrote {latest_path}")
    return True


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required", file=sys.stderr)
        return 1

    supabase = create_client(url, key)

    train_model(fetch_frame(supabase, is_pregame=True), "lr", "win_prob_latest.json")
    train_model(fetch_frame(supabase, is_pregame=False), "lr-live", "win_prob_live_latest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
