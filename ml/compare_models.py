"""Compare candidate classifiers on the live win-probability data.

Inspired by the exploratory modeling notebook: fit a panel of scikit-learn
classifiers on the SAME persisted feature rows the production model trains on,
evaluate them on a leakage-safe by-game validation split, and tabulate the
results so model selection is evidence-based rather than a guess.

Models compared (notebook panel):
    LogisticRegression · SVC · NearestCentroid · KNeighbors · HistGradientBoosting

The production serving path can only execute a linear model (coefficients +
scaler scored in Node), so this script is a *decision aid*: if a tree ensemble
clearly wins it justifies the ONNX upgrade path (tasks.md Phase 4); if LR is
within noise, the simple artifact stays. It writes a JSON + Markdown report to
models/ and never overwrites the live artifact.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python ml/compare_models.py
    # options: --pregame (default: live cohort)
"""

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.neighbors import KNeighborsClassifier, NearestCentroid
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from supabase import create_client

# Reuse the production trainer's data loaders so this comparison sees exactly
# the rows train_win_prob.py sees (same fetch, same by-game split).
from train_win_prob import fetch_frame, split_by_game

REPO_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = REPO_ROOT / "models"
MIN_TRAINING_GAMES = 50


def candidate_models():
    """The notebook panel. `proba` flags whether predict_proba is meaningful."""
    return [
        ("LogisticRegression", LogisticRegression(max_iter=1000), True),
        ("SVC", SVC(probability=True), True),
        ("NearestCentroid", NearestCentroid(), False),
        ("KNeighbors", KNeighborsClassifier(n_neighbors=15), True),
        ("HistGradientBoosting", HistGradientBoostingClassifier(max_iter=200), True),
    ]


def evaluate(name, model, has_proba, X_train, y_train, X_val, y_val):
    model.fit(X_train, y_train)
    preds = model.predict(X_val)
    result = {
        "model": name,
        "accuracy": float(accuracy_score(y_val, preds)),
        "log_loss": None,
        "brier": None,
        "roc_auc": None,
    }
    if has_proba and len(set(y_val)) > 1:
        probs = model.predict_proba(X_val)[:, 1]
        result["log_loss"] = float(log_loss(y_val, probs))
        result["brier"] = float(brier_score_loss(y_val, probs))
        result["roc_auc"] = float(roc_auc_score(y_val, probs))
    return result


def market_baseline(feature_names, X_val, y_val):
    """If the cohort carries the market no-vig prob, score it as a baseline."""
    if "home_no_vig_prob" not in feature_names or len(set(y_val)) <= 1:
        return None
    idx = feature_names.index("home_no_vig_prob")
    probs = np.clip(X_val[:, idx], 0.001, 0.999)
    return {
        "model": "baseline-market-novig",
        "accuracy": float(accuracy_score(y_val, (probs >= 0.5).astype(int))),
        "log_loss": float(log_loss(y_val, probs)),
        "brier": float(brier_score_loss(y_val, probs)),
        "roc_auc": float(roc_auc_score(y_val, probs)),
    }


def fmt(value):
    return "   n/a" if value is None else f"{value:.4f}"


def render_table(rows):
    header = f"{'Model':<24}{'Acc':>8}{'LogLoss':>10}{'Brier':>9}{'ROC-AUC':>10}"
    lines = [header, "-" * len(header)]
    for r in rows:
        lines.append(
            f"{r['model']:<24}{r['accuracy']:>8.4f}"
            f"{fmt(r['log_loss']):>10}{fmt(r['brier']):>9}{fmt(r['roc_auc']):>10}"
        )
    return "\n".join(lines)


def sort_key(row):
    # Rank by log loss when available (lower = better); push proba-less models
    # (NearestCentroid) to the bottom but keep them in the table.
    return (0, row["log_loss"]) if row["log_loss"] is not None else (1, -row["accuracy"])


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare classifiers on win-prob data")
    parser.add_argument("--pregame", action="store_true", help="use the pregame cohort instead of live")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required", file=sys.stderr)
        return 1

    supabase = create_client(url, key)
    cohort = "pregame" if args.pregame else "live"
    frame = fetch_frame(supabase, is_pregame=args.pregame)

    n_games = frame["game_pk"].nunique() if len(frame) else 0
    if n_games < MIN_TRAINING_GAMES:
        print(f"[{cohort}] Only {n_games} labeled games; need {MIN_TRAINING_GAMES}. Aborting.")
        return 1

    # Drop rows from an older feature schema, mirroring the trainer.
    feature_names = frame.iloc[0]["feature_names"]
    consistent = frame["feature_names"].apply(lambda names: names == feature_names)
    if not consistent.all():
        print(f"[{cohort}] Dropping {int((~consistent).sum())} rows with an older feature schema.")
        frame = frame[consistent]

    train_df, val_df = split_by_game(frame)
    X_train = np.array(train_df["feature_values"].tolist(), dtype=float)
    y_train = train_df["home_win"].astype(int).to_numpy()
    X_val = np.array(val_df["feature_values"].tolist(), dtype=float)
    y_val = val_df["home_win"].astype(int).to_numpy()

    scaler = StandardScaler().fit(X_train)
    X_train_s = scaler.transform(X_train)
    X_val_s = scaler.transform(X_val)

    print(
        f"[{cohort}] {n_games} games · {len(train_df)} train rows · {len(val_df)} val rows "
        f"· {len(feature_names)} features\n"
    )

    rows = []
    for name, model, has_proba in candidate_models():
        try:
            rows.append(evaluate(name, model, has_proba, X_train_s, y_train, X_val_s, y_val))
            print(f"  fitted {name}")
        except Exception as exc:  # noqa: BLE001 — report, don't abort the panel
            print(f"  {name} failed: {exc}", file=sys.stderr)

    baseline = market_baseline(feature_names, X_val, y_val)
    if baseline:
        rows.append(baseline)

    rows.sort(key=sort_key)

    table = render_table(rows)
    best = rows[0]["model"] if rows else "n/a"
    print("\n" + table)
    print(f"\nBest by log loss: {best}")

    MODELS_DIR.mkdir(exist_ok=True)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cohort": cohort,
        "n_games": int(n_games),
        "n_train_rows": int(len(train_df)),
        "n_val_rows": int(len(val_df)),
        "features": feature_names,
        "results": rows,
        "best_by_log_loss": best,
    }
    json_path = MODELS_DIR / f"model_comparison_{cohort}_{date.today().isoformat()}.json"
    md_path = MODELS_DIR / f"model_comparison_{cohort}_{date.today().isoformat()}.md"
    json_path.write_text(json.dumps(report, indent=2) + "\n")
    md_path.write_text(
        f"# Model comparison — {cohort} cohort ({date.today().isoformat()})\n\n"
        f"{n_games} games · {len(train_df)} train / {len(val_df)} val rows · "
        f"{len(feature_names)} features. By-game time split.\n\n"
        "```\n" + table + "\n```\n\n"
        f"**Best by log loss:** {best}\n"
    )
    print(f"\nWrote {json_path}\nWrote {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
