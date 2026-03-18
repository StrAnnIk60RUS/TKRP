import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
from joblib import dump, load
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.linear_model import Ridge


def clamp01(x: float) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    if not np.isfinite(v):
        return 0.0
    return float(max(0.0, min(1.0, v)))


def get_repo_paths():
    # server/ml -> server/data
    server_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    data_dir = os.path.join(server_dir, "data")
    precedents_path = os.path.join(data_dir, "precedents.json")
    ml_dir = os.path.join(data_dir, "ml")
    model_path = os.path.join(ml_dir, "engagement_model.joblib")
    metadata_path = os.path.join(ml_dir, "engagement_model_metadata.json")
    return precedents_path, model_path, metadata_path


def load_training_data(precedents_path: str):
    if not os.path.exists(precedents_path):
        raise FileNotFoundError(f"precedents file not found: {precedents_path}")

    with open(precedents_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    publications = payload.get("publications") or []
    embeddings = []
    targets = []

    for pub in publications:
        emb = pub.get("embedding")
        er = pub.get("engagement_rate")

        if not isinstance(emb, list) or not emb:
            continue
        if not isinstance(er, (int, float)) or not np.isfinite(er):
            # Allow 0 but skip missing/non-numeric
            continue

        emb_f = [float(x) for x in emb]
        if not all(np.isfinite(v) for v in emb_f):
            continue

        embeddings.append(emb_f)
        targets.append(clamp01(er))

    if not embeddings:
        raise ValueError("no training samples with embedding+engagement_rate found")

    # Ensure consistent embedding dimension
    dims = {len(x) for x in embeddings}
    if len(dims) != 1:
        # Drop inconsistent ones
        target_dim = max(dims, key=lambda d: d)
        filtered_embeddings = []
        filtered_targets = []
        for x, y in zip(embeddings, targets):
            if len(x) == target_dim:
                filtered_embeddings.append(x)
                filtered_targets.append(y)
        embeddings = filtered_embeddings
        targets = filtered_targets

    X = np.asarray(embeddings, dtype=np.float32)
    y = np.asarray(targets, dtype=np.float32)
    return X, y


def build_model(random_state: int = 42) -> Pipeline:
    # Pipeline makes it robust for feature scaling.
    # With small sample sizes (tens of points) and high-dimensional embeddings,
    # MLPRegressor tends to overfit and produce unstable outputs.
    # Ridge regression is much more stable for this regime.
    ridge = Ridge(alpha=1.0, random_state=random_state)
    return Pipeline([("scaler", StandardScaler()), ("ridge", ridge)])


def train():
    precedents_path, model_path, metadata_path = get_repo_paths()
    X, y = load_training_data(precedents_path)

    # Small datasets: use a conservative split
    test_size = 0.2
    if X.shape[0] < 20:
        test_size = 0.25
    if X.shape[0] < 10:
        # For very tiny datasets, train on all and skip holdout metrics
        model = build_model()
        model.fit(X, y)
        mse = None
        r2 = None
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42
        )
        model = build_model()
        model.fit(X_train, y_train)
        pred = model.predict(X_test)
        mse = float(mean_squared_error(y_test, pred))
        r2 = float(r2_score(y_test, pred))

    ml_dir = os.path.dirname(model_path)
    os.makedirs(ml_dir, exist_ok=True)
    dump(model, model_path)

    metadata = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "precedents_path": precedents_path,
        "samples": int(y.shape[0]),
        "embedding_dim": int(X.shape[1]),
        "metrics": {"mse": mse, "r2": r2},
        "target": "engagement_rate_clamped_0_1",
        "model_type": "sklearn.RidgeRegression(via Pipeline: StandardScaler+Ridge)",
    }
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    return {"success": True, "model_path": model_path, "metadata": metadata}


def predict_from_embeddings(payload: dict):
    precedents_path, model_path, metadata_path = get_repo_paths()
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"model not found: {model_path}")

    model = load(model_path)

    embeddings = payload.get("embeddings") or []
    if not isinstance(embeddings, list) or not embeddings:
        raise ValueError("predict payload must contain non-empty embeddings[][]")

    X = np.asarray(embeddings, dtype=np.float32)
    preds = model.predict(X).tolist()
    preds = [clamp01(p) for p in preds]

    meta = None
    if os.path.exists(metadata_path):
        with open(metadata_path, "r", encoding="utf-8") as f:
            try:
                meta = json.load(f)
            except Exception:
                meta = None

    return {"predictions": preds, "model_metadata": meta}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "mode is required: train|predict"}))
        sys.exit(2)

    mode = sys.argv[1].strip().lower()
    if mode == "train":
        result = train()
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0)

    if mode == "predict":
        stdin_payload = {}
        if not sys.stdin.isatty():
            try:
                stdin_payload = json.load(sys.stdin)
            except Exception:
                stdin_payload = {}
        payload = stdin_payload or {}
        result = predict_from_embeddings(payload)
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0)

    print(json.dumps({"success": False, "error": f"unknown mode: {mode}"}))
    sys.exit(2)


if __name__ == "__main__":
    main()

