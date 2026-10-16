"""Feature drift monitor: compares current feature vector statistics against
statistics recorded in training metadata.

Input (JSON on stdin):
{
  "model_key": "post" | "content_plan",
  "features": [[...], ...],            # current feature vectors
  "feature_names": ["...", ...],       # optional; otherwise read from metadata
  "training_stats": { name: {"mean": m, "std": s} },  # optional; otherwise read from metadata
  "threshold": 0.5                     # optional relative drift threshold
}

If training_stats/feature_names are absent, they are read from the model metadata
JSON in ML_MODEL_DIR.

Exit code: 0 = no drift, 1 = drift detected, 2 = usage/input error.
"""

import json
import os
import sys
from pathlib import Path

import numpy as np


def parse_input():
    raw = sys.stdin.read().strip()
    if not raw:
        raise SystemExit('No input on stdin')
    return json.loads(raw)


def load_training_stats(model_key, model_dir):
    metadata_names = {
        'post': 'post_metrics_model_metadata.json',
        'content_plan': 'plan_metrics_model_metadata.json'
    }
    path = Path(model_dir) / metadata_names[model_key]
    if not path.exists():
        return None, None
    with open(path) as f:
        metadata = json.load(f)
    return metadata.get('feature_stats'), metadata.get('feature_names')


def main():
    try:
        request = parse_input()
    except json.JSONDecodeError as error:
        print(f'Invalid JSON input: {error}')
        raise SystemExit(2)

    model_key = request.get('model_key')
    if model_key not in ('post', 'content_plan'):
        print(f'Unknown model_key: {model_key}')
        raise SystemExit(2)

    features = np.asarray(request.get('features', []), dtype=np.float64)
    if features.size == 0 or features.ndim != 2:
        print('No feature vectors provided')
        raise SystemExit(2)

    threshold = float(request.get('threshold', os.environ.get('DRIFT_THRESHOLD', 0.5)))
    training_stats = request.get('training_stats')
    feature_names = request.get('feature_names')

    if not training_stats:
        model_dir = os.environ.get('ML_MODEL_DIR', 'data/ml')
        training_stats, metadata_names = load_training_stats(model_key, model_dir)
        feature_names = feature_names or metadata_names

    if not training_stats or not feature_names:
        print('No training feature stats available; train a model first (metadata lacks feature_stats).')
        raise SystemExit(2)

    drift_report = []
    for i, name in enumerate(feature_names):
        if i >= features.shape[1]:
            break
        stats = training_stats.get(name)
        if not stats:
            continue
        current_mean = float(np.mean(features[:, i]))
        current_std = float(np.std(features[:, i]))
        base_mean = float(stats.get('mean', 0.0))
        base_std = float(stats.get('std', 0.0))
        scale = max(abs(base_mean), abs(base_std), 1e-9)
        mean_drift = abs(current_mean - base_mean) / scale
        std_drift = abs(current_std - base_std) / max(abs(base_std), 1e-9)
        if mean_drift > threshold or std_drift > threshold:
            drift_report.append({
                'feature': name,
                'training_mean': base_mean,
                'current_mean': current_mean,
                'training_std': base_std,
                'current_std': current_std,
                'mean_drift': round(mean_drift, 4),
                'std_drift': round(std_drift, 4)
            })

    report = {
        'model_key': model_key,
        'threshold': threshold,
        'n_samples': int(features.shape[0]),
        'drifted_features': drift_report
    }
    print(json.dumps(report, indent=2))

    if drift_report:
        print(f"DRIFT DETECTED: {len(drift_report)} feature(s) drifted beyond threshold {threshold}")
        raise SystemExit(1)
    print('No feature drift detected.')
    raise SystemExit(0)


if __name__ == '__main__':
    main()
