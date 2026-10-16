"""Stamp legacy ML artifacts (without feature_set_version metadata) with a version.

Usage:
  python tools/ml/migrate_model_versions.py [--version v1] [--model-dir data/ml]

Legacy artifacts (joblib payload and metadata JSON without feature_set_version)
are stamped with --version (default v1) so that version checks treat them
explicitly instead of silently assuming legacy state. Prints env guidance
afterwards.
"""

import argparse
import json
import os
from pathlib import Path

import joblib


def parse_args():
    parser = argparse.ArgumentParser(description='Stamp legacy ML model artifacts with a feature set version.')
    parser.add_argument('--version', default='v1', help='Version to stamp legacy artifacts with (default: v1)')
    parser.add_argument('--model-dir', default=os.environ.get('ML_MODEL_DIR', 'data/ml'), help='Model artifacts directory')
    return parser.parse_args()


def migrate_pair(model_path, metadata_path, version):
    stamped = []
    if Path(model_path).exists():
        data = joblib.load(model_path)
        if isinstance(data, dict) and data.get('feature_set_version') is None:
            data['feature_set_version'] = version
            joblib.dump(data, model_path)
            stamped.append(str(model_path))
    if Path(metadata_path).exists():
        with open(metadata_path) as f:
            metadata = json.load(f)
        if metadata.get('feature_set_version') is None:
            metadata['feature_set_version'] = version
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            stamped.append(str(metadata_path))
    return stamped


def main():
    args = parse_args()
    model_dir = Path(args.model_dir)

    pairs = [
        (model_dir / 'post_metrics_model.joblib', model_dir / 'post_metrics_model_metadata.json'),
        (model_dir / 'plan_metrics_model.joblib', model_dir / 'plan_metrics_model_metadata.json'),
    ]

    total = 0
    for model_path, metadata_path in pairs:
        if not Path(model_path).exists() and not Path(metadata_path).exists():
            print(f'Skip: no artifacts found for pair {model_path.name}')
            continue
        stamped = migrate_pair(model_path, metadata_path, args.version)
        for item in stamped:
            print(f'Stamped {item} with feature_set_version={args.version}')
        total += len(stamped)

    print()
    print('Guidance:')
    print(f"  - Legacy artifacts are now explicitly '{args.version}'.")
    print("  - Set EXPECTED_FEATURE_SET_VERSION in .env to the version your JS feature builders emit (default 'v2').")
    print('  - Retrain via POST /ml/relevance/train to produce artifacts with the current version.')
    print(f'  - Total files stamped: {total}')


if __name__ == '__main__':
    main()
