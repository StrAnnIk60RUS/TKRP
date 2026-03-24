import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
from joblib import dump, load
from sklearn.compose import TransformedTargetRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

MODEL_SPECS = {
    "post": {
        "model_filename": "post_likes_model.joblib",
        "metadata_filename": "post_likes_model_metadata.json",
        "target_name": "post_likes",
    },
    "content_plan": {
        "model_filename": "content_plan_likes_model.joblib",
        "metadata_filename": "content_plan_likes_model_metadata.json",
        "target_name": "content_plan_total_likes",
    },
}


def clamp_non_negative(x: float) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    if not np.isfinite(v):
        return 0.0
    return float(max(0.0, v))


def get_model_paths(model_key: str):
    spec = MODEL_SPECS.get(model_key)
    if not spec:
        raise ValueError(f"unknown model key: {model_key}")
    server_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    ml_dir = os.path.join(server_dir, "data", "ml")
    model_path = os.path.join(ml_dir, spec["model_filename"])
    metadata_path = os.path.join(ml_dir, spec["metadata_filename"])
    return ml_dir, model_path, metadata_path, spec


def read_payload():
    if sys.stdin.isatty():
        return {}
    try:
        return json.load(sys.stdin) or {}
    except Exception:
        return {}


def parse_dataset(payload: dict):
    features = payload.get("features") or []
    targets = payload.get("targets") or []
    feature_names = payload.get("feature_names") or []
    if not isinstance(features, list) or not features:
        raise ValueError("train payload must contain non-empty features[][]")
    if not isinstance(targets, list) or len(targets) != len(features):
        raise ValueError("train payload must contain targets[] with same length as features")

    X = np.asarray(features, dtype=np.float32)
    y = np.asarray([clamp_non_negative(v) for v in targets], dtype=np.float32)
    if X.ndim != 2:
        raise ValueError("features must be 2-dimensional")
    if y.ndim != 1:
        raise ValueError("targets must be 1-dimensional")
    if X.shape[0] < 2:
        raise ValueError("at least 2 samples are required")
    if X.shape[1] < 1:
        raise ValueError("at least 1 feature is required")
    return X, y, feature_names


def build_model(sample_count: int, random_state: int = 42):
    use_early_stopping = sample_count >= 30
    base = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "mlp",
                MLPRegressor(
                    hidden_layer_sizes=(64, 32),
                    activation="relu",
                    solver="adam",
                    alpha=0.001,
                    learning_rate_init=0.001,
                    max_iter=1200,
                    early_stopping=use_early_stopping,
                    n_iter_no_change=25,
                    validation_fraction=0.15,
                    random_state=random_state,
                ),
            ),
        ]
    )
    return TransformedTargetRegressor(
        regressor=base,
        func=np.log1p,
        inverse_func=np.expm1,
        check_inverse=False,
    )


def summarize_targets(y: np.ndarray):
    return {
        "min": float(np.min(y)),
        "max": float(np.max(y)),
        "mean": float(np.mean(y)),
        "median": float(np.median(y)),
    }


def train_model(model_key: str, payload: dict):
    ml_dir, model_path, metadata_path, spec = get_model_paths(model_key)
    X, y, feature_names = parse_dataset(payload)
    test_size = 0.2 if X.shape[0] >= 20 else 0.25

    if X.shape[0] < 10:
        model = build_model(int(X.shape[0]))
        model.fit(X, y)
        metrics = {"mse": None, "mae": None, "r2": None}
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42
        )
        model = build_model(int(X.shape[0]))
        model.fit(X_train, y_train)
        pred = np.maximum(model.predict(X_test), 0)
        metrics = {
            "mse": float(mean_squared_error(y_test, pred)),
            "mae": float(mean_absolute_error(y_test, pred)),
            "r2": float(r2_score(y_test, pred)),
        }

    os.makedirs(ml_dir, exist_ok=True)
    dump(model, model_path)

    metadata = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model_key": model_key,
        "model_path": model_path,
        "samples": int(y.shape[0]),
        "feature_dim": int(X.shape[1]),
        "feature_names": feature_names if isinstance(feature_names, list) else [],
        "target_name": spec["target_name"],
        "target_summary": summarize_targets(y),
        "metrics": metrics,
        "model_type": "sklearn.MLPRegressor(via StandardScaler + log1p target transform)",
    }
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    return {"success": True, "model_path": model_path, "metadata": metadata}


def adapt_feature_dim(X: np.ndarray, expected_dim: int) -> np.ndarray:
    actual_dim = X.shape[1]
    if actual_dim == expected_dim:
        return X
    if actual_dim < expected_dim:
        pad = np.zeros((X.shape[0], expected_dim - actual_dim), dtype=np.float32)
        return np.hstack([X, pad])
    return X[:, :expected_dim]


def predict_model(model_key: str, payload: dict):
    _, model_path, metadata_path, _ = get_model_paths(model_key)
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"model not found: {model_path}")

    features = payload.get("features") or []
    if not isinstance(features, list) or not features:
        raise ValueError("predict payload must contain non-empty features[][]")
    X = np.asarray(features, dtype=np.float32)
    if X.ndim != 2:
        raise ValueError("features must be 2-dimensional")

    model = load(model_path)
    metadata = None
    if os.path.exists(metadata_path):
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

    expected_dim = metadata.get("feature_dim") if metadata else None
    if expected_dim is not None:
        X = adapt_feature_dim(X, int(expected_dim))
    predictions = np.maximum(model.predict(X), 0).tolist()
    return {"predictions": predictions, "model_metadata": metadata}


def main():
    if len(sys.argv) < 3:
        print(
            json.dumps(
                {"success": False, "error": "usage: engagement_model.py train|predict post|content_plan"}
            )
        )
        sys.exit(2)

    mode = sys.argv[1].strip().lower()
    model_key = sys.argv[2].strip().lower()
    payload = read_payload()

    if mode == "train":
        print(json.dumps(train_model(model_key, payload), ensure_ascii=False))
        sys.exit(0)

    if mode == "predict":
        print(json.dumps(predict_model(model_key, payload), ensure_ascii=False))
        sys.exit(0)

    print(json.dumps({"success": False, "error": f"unknown mode: {mode}"}))
    sys.exit(2)


if __name__ == "__main__":
    main()

