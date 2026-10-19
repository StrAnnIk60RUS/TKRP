import sys
import json
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.multioutput import MultiOutputRegressor
try:
    from lightgbm import LGBMRegressor
    HAS_LIGHTGBM = True
except ImportError:
    HAS_LIGHTGBM = False
    try:
        from sklearn.ensemble import HistGradientBoostingRegressor
        HAS_HIST_GB = True
    except ImportError:
        HAS_HIST_GB = False
        from sklearn.neural_network import MLPRegressor
import joblib
import os
from pathlib import Path

# Конфигурация
MODEL_DIR = Path(os.environ.get('ML_MODEL_DIR', 'data/ml'))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Имена целевых метрик
POST_TARGET_NAMES = ['likes', 'shares', 'views']
PLAN_TARGET_NAMES = ['total_likes', 'total_shares', 'total_views']

# Feature set versioning: artifacts stamped with a version are validated hard;
# legacy artifacts (no version metadata) are treated as LEGACY_FEATURE_SET_VERSION
# and only produce a warning.
EXPECTED_FEATURE_SET_VERSION = os.environ.get('EXPECTED_FEATURE_SET_VERSION', 'v2')
LEGACY_FEATURE_SET_VERSION = 'v1'


def check_feature_set_version(metadata_path, model_key):
    """Verifies feature_set_version of a saved model against EXPECTED_FEATURE_SET_VERSION.

    - Missing version (legacy artifact): warn only, treated as LEGACY_FEATURE_SET_VERSION.
    - Present but mismatched: raise (hard error per spec).
    """
    try:
        with open(metadata_path) as f:
            metadata = json.load(f)
    except FileNotFoundError:
        return

    model_version = metadata.get('feature_set_version')
    if model_version is None:
        print(
            f"[ML] Warning: {model_key} model has no feature_set_version metadata "
            f"(legacy, assumed {LEGACY_FEATURE_SET_VERSION}); expected {EXPECTED_FEATURE_SET_VERSION}. "
            "Retrain or run tools/ml/migrate_model_versions.py.",
            file=sys.stderr
        )
        return
    if model_version != EXPECTED_FEATURE_SET_VERSION:
        raise ValueError(
            f"Feature set version mismatch for {model_key}: model={model_version}, "
            f"expected={EXPECTED_FEATURE_SET_VERSION}. Retrain with current feature set."
        )


def log_transform(values):
    """log1p трансформация для неотрицательных данных"""
    return np.log1p(np.maximum(values, 0))


def exp_transform(values):
    """expm1 обратная трансформация"""
    return np.expm1(values)


def calculate_complex_er(likes, shares, views, comments=0):
    """Расчет комплексного Engagement Rate (ER).

    Формула: (likes + 2 * comments + 3 * shares) / views (если views > 0),
    иначе сатурационный прокси interactions / (interactions + 50).
    Ограничен диапазоном [0.0, 1.0].
    """
    l = max(float(likes or 0), 0.0)
    s = max(float(shares or 0), 0.0)
    v = max(float(views or 0), 0.0)
    c = max(float(comments or 0), 0.0)
    interactions = l + (2.0 * c) + (3.0 * s)
    if v > 0.0:
        return min(max(interactions / v, 0.0), 1.0)
    if interactions > 0.0:
        return min(max(interactions / (interactions + 50.0), 0.0), 1.0)
    return 0.0


class MultiMetricPredictor:
    """Multi-output регрессор для предсказания нескольких метрик (LightGBM / HistGB)"""

    def __init__(self, target_names, random_state=42, **kwargs):
        self.target_names = target_names
        self.n_targets = len(target_names)
        self.random_state = random_state

        force_backend = os.environ.get('ML_FORCE_BACKEND', '').strip().lower()
        use_lgbm = HAS_LIGHTGBM and force_backend not in ('histgradientboosting', 'histgb', 'sklearn', 'mlp')
        use_hist_gb = (HAS_HIST_GB and force_backend != 'mlp') if not use_lgbm else False

        if use_lgbm:
            self.model_backend = 'LightGBM'
            base_estimator = LGBMRegressor(
                n_estimators=100,
                learning_rate=0.05,
                num_leaves=31,
                random_state=random_state,
                n_jobs=1,
                verbose=-1
            )
        elif use_hist_gb:
            self.model_backend = 'HistGradientBoosting'
            base_estimator = HistGradientBoostingRegressor(
                max_iter=100,
                learning_rate=0.05,
                max_leaf_nodes=31,
                random_state=random_state
            )
        else:
            self.model_backend = 'MLPRegressor'
            base_estimator = MLPRegressor(
                hidden_layer_sizes=(128, 64),
                activation='relu',
                solver='adam',
                max_iter=500,
                random_state=random_state,
                early_stopping=True,
                validation_fraction=0.1,
                n_iter_no_change=20,
                verbose=False
            )

        self.model = MultiOutputRegressor(base_estimator, n_jobs=1)
        self.scaler_X = StandardScaler()
        self.scaler_y = StandardScaler()
        self._is_fitted = False
        self.is_fallback = False
        self.fallback_reason = None
        self.fallback_metadata = None

    def preprocess_X(self, X):
        """Масштабирование признаков"""
        return self.scaler_X.transform(X)

    def preprocess_y(self, y):
        """log1p + масштабирование таргетов (только transform, без fit)"""
        y_log = np.zeros_like(y)
        for i in range(self.n_targets):
            y_log[:, i] = log_transform(y[:, i])
        return self.scaler_y.transform(y_log)

    def fit_preprocess_y(self, y):
        """fit scaler_y на log1p данных"""
        y_log = np.zeros_like(y)
        for i in range(self.n_targets):
            y_log[:, i] = log_transform(y[:, i])
        self.scaler_y.fit(y_log)
        return self.scaler_y.transform(y_log)

    def fit(self, X, y):
        """
        X: shape (n_samples, n_features)
        y: shape (n_samples, n_targets)
        """
        X_arr = np.asarray(X, dtype=np.float64)
        y_arr = np.asarray(y, dtype=np.float64)

        n_samples = X_arr.shape[0]
        # Adapt hyperparameters for small sample sizes so tree splits can occur
        min_child_samples = max(2, min(20, n_samples // 4))
        num_leaves = max(2, min(31, n_samples // max(2, min_child_samples)))

        force_backend = os.environ.get('ML_FORCE_BACKEND', '').strip().lower()
        use_lgbm = HAS_LIGHTGBM and force_backend not in ('histgradientboosting', 'histgb', 'sklearn', 'mlp')
        use_hist_gb = (HAS_HIST_GB and force_backend != 'mlp') if not use_lgbm else False

        if use_lgbm:
            self.model_backend = 'LightGBM'
            base_estimator = LGBMRegressor(
                n_estimators=100,
                learning_rate=0.05,
                num_leaves=num_leaves,
                min_child_samples=min_child_samples,
                random_state=self.random_state,
                n_jobs=1,
                verbose=-1
            )
            self.model = MultiOutputRegressor(base_estimator, n_jobs=1)
        elif use_hist_gb:
            self.model_backend = 'HistGradientBoosting'
            base_estimator = HistGradientBoostingRegressor(
                max_iter=100,
                learning_rate=0.05,
                max_leaf_nodes=num_leaves,
                min_samples_leaf=min_child_samples,
                random_state=self.random_state
            )
            self.model = MultiOutputRegressor(base_estimator, n_jobs=1)

        # 1. Масштабируем признаки
        X_scaled = self.scaler_X.fit_transform(X_arr)

        # 2. Fit scaler_y на log1p данных И сразу transform
        y_scaled = self.fit_preprocess_y(y_arr)

        # 3. Обучаем модель
        self.model.fit(X_scaled, y_scaled)
        self._is_fitted = True
        return self

    def _predict_fallback(self, X_arr):
        n_samples = X_arr.shape[0]
        y_result = np.zeros((n_samples, self.n_targets), dtype=np.float64)
        metadata = getattr(self, 'fallback_metadata', {}) or {}
        target_summary = metadata.get('target_summary', {})
        feature_stats = metadata.get('feature_stats', {})
        feature_names = metadata.get('feature_names', [])

        defaults = {
            'total_likes': 350.0,
            'total_shares': 50.0,
            'total_views': 30000.0,
            'likes': 50.0,
            'shares': 5.0,
            'views': 1200.0
        }

        modulations = np.ones(n_samples, dtype=np.float64)
        if feature_stats and feature_names and X_arr.shape[1] >= len(feature_names):
            z_scores = np.zeros(n_samples, dtype=np.float64)
            valid_feats = 0
            for idx, name in enumerate(feature_names):
                stats = feature_stats.get(name)
                if stats and 'mean' in stats and 'std' in stats:
                    mean = float(stats['mean'])
                    std = float(stats['std'])
                    if std > 1e-6:
                        col = X_arr[:, idx]
                        z = np.clip((col - mean) / std, -2.5, 2.5)
                        z_scores += z
                        valid_feats += 1
            if valid_feats > 0:
                avg_z = z_scores / valid_feats
                modulations = np.clip(1.0 + 0.15 * avg_z, 0.70, 1.40)

        for i, target_name in enumerate(self.target_names):
            summary = target_summary.get(target_name, {})
            mean_val = float(summary.get('mean', defaults.get(target_name, 100.0)))
            min_val = float(summary.get('min', 0.0))
            max_val = float(summary.get('max', max(mean_val * 3.0, 10.0)))

            pred_col = mean_val * modulations
            y_result[:, i] = np.clip(pred_col, min_val, max_val)

        return y_result

    def predict(self, X):
        """Возвращает предсказания в исходной шкале (не log, не нормализованные)"""
        if not self._is_fitted:
            raise RuntimeError("Model must be fitted before predict")

        X_arr = np.asarray(X, dtype=np.float64)
        if getattr(self, 'is_fallback', False):
            return self._predict_fallback(X_arr)

        X_scaled = self.preprocess_X(X_arr)
        y_pred_scaled = self.model.predict(X_scaled)
        y_denorm = self.scaler_y.inverse_transform(y_pred_scaled)

        y_result = np.zeros_like(y_denorm)
        for i in range(self.n_targets):
            y_result[:, i] = exp_transform(y_denorm[:, i])

        return y_result

    def save(self, model_path, metadata_path, extra_metadata=None):
        """Сохраняет модель и метаданные"""
        backend = getattr(self, 'model_backend', 'LightGBM')
        _MODEL_CACHE.pop(str(Path(model_path).resolve()), None)
        joblib.dump({
            'model': self.model,
            'scaler_X': self.scaler_X,
            'scaler_y': self.scaler_y,
            'target_names': self.target_names,
            'is_fitted': self._is_fitted,
            'model_backend': backend,
            'feature_set_version': (extra_metadata or {}).get('feature_set_version'),
            'ontology_features_enabled': (extra_metadata or {}).get('ontology_features_enabled')
        }, model_path)

        metadata = {
            'target_names': self.target_names,
            'n_targets': self.n_targets,
            'model_type': f'MultiOutputRegressor({backend})',
            'feature_names': None
        }
        if extra_metadata:
            metadata.update(extra_metadata)
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

    @classmethod
    def _create_fallback_instance(cls, model_path, metadata_path=None, error=None):
        """Creates a fallback instance using target distribution metadata when artifact cannot be loaded."""
        is_plan = 'plan' in str(model_path).lower()
        default_targets = PLAN_TARGET_NAMES if is_plan else POST_TARGET_NAMES
        metadata = {}
        if metadata_path and Path(metadata_path).exists():
            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
            except Exception:
                pass

        target_names = metadata.get('target_names', default_targets)
        instance = cls(target_names=target_names)
        instance._is_fitted = True
        instance.is_fallback = True
        instance.fallback_reason = str(error) if error else 'missing_backend_or_corrupt_artifact'
        instance.fallback_metadata = metadata
        instance.model_backend = 'FallbackHeuristic'
        return instance

    @classmethod
    def load(cls, model_path, metadata_path=None):
        """Загружает модель с graceful fallback при несовместимости окружения (например, отсутствие lightgbm)"""
        model_path = Path(model_path)
        if not model_path.exists():
            return cls._create_fallback_instance(
                model_path, metadata_path, error=FileNotFoundError(f"Model not found: {model_path}")
            )

        try:
            data = joblib.load(model_path)
            instance = cls(target_names=data['target_names'])
            instance.model = data['model']
            instance.scaler_X = data['scaler_X']
            instance.scaler_y = data['scaler_y']
            instance._is_fitted = data.get('is_fitted', True)
            instance.model_backend = data.get('model_backend', 'LightGBM')
            instance.is_fallback = False
            return instance
        except Exception as e:
            print(
                f"[ML] Warning: Could not load model artifact from {model_path} ({e}). "
                f"Falling back to calibrated heuristic baseline.",
                file=sys.stderr
            )
            return cls._create_fallback_instance(model_path, metadata_path, error=e)


def train_post_model(features, targets, feature_names=None, version_info=None):
    """Обучение модели для постов"""
    X = np.array(features)
    y = np.array(targets)

    print(f"[ML] Training post model: X.shape={X.shape}, y.shape={y.shape}", file=sys.stderr)

    model = MultiMetricPredictor(target_names=POST_TARGET_NAMES)
    model.fit(X, y)

    model_path = MODEL_DIR / 'post_metrics_model.joblib'
    metadata_path = MODEL_DIR / 'post_metrics_model_metadata.json'
    extra = {'feature_set_version': EXPECTED_FEATURE_SET_VERSION}
    if version_info:
        if version_info.get('feature_set_version'):
            extra['feature_set_version'] = version_info['feature_set_version']
        if 'ontology_features_enabled' in version_info:
            extra['ontology_features_enabled'] = bool(version_info['ontology_features_enabled'])
    model.save(model_path, metadata_path, extra_metadata=extra)

    if feature_names:
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        metadata['feature_names'] = feature_names
        metadata['n_features'] = len(feature_names)
        metadata['feature_stats'] = {
            name: {
                'mean': float(np.mean(X[:, i])),
                'std': float(np.std(X[:, i]))
            }
            for i, name in enumerate(feature_names)
        }

        # Добавляем statisticу по таргетам
        target_summary = {}
        for i, name in enumerate(POST_TARGET_NAMES):
            target_summary[name] = {
                'min': float(np.min(y[:, i])),
                'max': float(np.max(y[:, i])),
                'mean': float(np.mean(y[:, i]))
            }
        metadata['target_summary'] = target_summary

        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

    return {
        'model_path': str(model_path),
        'metadata_path': str(metadata_path),
        'n_features': X.shape[1],
        'n_samples': X.shape[0]
    }


def train_plan_model(features, targets, feature_names=None, version_info=None):
    """Обучение модели для планов"""
    X = np.array(features)
    y = np.array(targets)

    print(f"[ML] Training plan model: X.shape={X.shape}, y.shape={y.shape}", file=sys.stderr)

    model = MultiMetricPredictor(target_names=PLAN_TARGET_NAMES)
    model.fit(X, y)

    model_path = MODEL_DIR / 'plan_metrics_model.joblib'
    metadata_path = MODEL_DIR / 'plan_metrics_model_metadata.json'
    extra = {'feature_set_version': EXPECTED_FEATURE_SET_VERSION}
    if version_info:
        if version_info.get('feature_set_version'):
            extra['feature_set_version'] = version_info['feature_set_version']
        if 'ontology_features_enabled' in version_info:
            extra['ontology_features_enabled'] = bool(version_info['ontology_features_enabled'])
    model.save(model_path, metadata_path, extra_metadata=extra)

    if feature_names:
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        metadata['feature_names'] = feature_names
        metadata['n_features'] = len(feature_names)
        metadata['feature_stats'] = {
            name: {
                'mean': float(np.mean(X[:, i])),
                'std': float(np.std(X[:, i]))
            }
            for i, name in enumerate(feature_names)
        }

        # Добавляем statisticу по таргетам
        target_summary = {}
        for i, name in enumerate(PLAN_TARGET_NAMES):
            target_summary[name] = {
                'min': float(np.min(y[:, i])),
                'max': float(np.max(y[:, i])),
                'mean': float(np.mean(y[:, i]))
            }
        metadata['target_summary'] = target_summary

        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

    return {
        'model_path': str(model_path),
        'metadata_path': str(metadata_path),
        'n_features': X.shape[1],
        'n_samples': X.shape[0]
    }


_MODEL_CACHE = {}


def get_cached_model(model_path, metadata_path, model_type):
    """Кэширует загруженную модель в памяти процесса, проверяя mtime файла модели и метаданных."""
    model_path = Path(model_path)
    metadata_path = Path(metadata_path)
    resolved_key = str(model_path.resolve())
    mtime = model_path.stat().st_mtime
    meta_mtime = metadata_path.stat().st_mtime if metadata_path.exists() else 0.0

    entry = _MODEL_CACHE.get(resolved_key)
    if entry and entry["mtime"] == mtime and entry["meta_mtime"] == meta_mtime:
        return entry["model"]

    check_feature_set_version(metadata_path, model_type)
    model = MultiMetricPredictor.load(model_path, metadata_path=metadata_path)
    _MODEL_CACHE[resolved_key] = {
        "mtime": mtime,
        "meta_mtime": meta_mtime,
        "model": model,
    }
    return model


def predict_post_metrics(features):
    """Предсказание метрик для постов"""
    model_path = MODEL_DIR / 'post_metrics_model.joblib'
    metadata_path = MODEL_DIR / 'post_metrics_model_metadata.json'

    if not model_path.exists() and not metadata_path.exists():
        raise FileNotFoundError(f"Model and metadata not found: {model_path}")

    model = get_cached_model(model_path, metadata_path, 'post')
    X = np.array(features, dtype=np.float64)
    # Defensive sanitization: JS side should already sanitize, but keep model robust.
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    predictions = model.predict(X)
    predictions = np.round(predictions).astype(int)

    complex_er_list = [
        round(calculate_complex_er(pred[0], pred[1], pred[2]), 4)
        for pred in predictions
    ]

    result = {
        'predictions': predictions.tolist(),
        'target_names': POST_TARGET_NAMES,
        'complex_er': complex_er_list,
        'engagement_rates': complex_er_list
    }
    if getattr(model, 'is_fallback', False):
        result['fallback'] = True
        result['fallback_reason'] = getattr(model, 'fallback_reason', 'missing_backend_or_load_error')
    return result


def predict_plan_metrics(features):
    """Предсказание метрик для планов"""
    model_path = MODEL_DIR / 'plan_metrics_model.joblib'
    metadata_path = MODEL_DIR / 'plan_metrics_model_metadata.json'

    if not model_path.exists() and not metadata_path.exists():
        raise FileNotFoundError(f"Model and metadata not found: {model_path}")

    model = get_cached_model(model_path, metadata_path, 'content_plan')
    X = np.array(features, dtype=np.float64)
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    predictions = model.predict(X)
    predictions = np.round(predictions).astype(int)

    complex_er_list = [
        round(calculate_complex_er(pred[0], pred[1], pred[2]), 4)
        for pred in predictions
    ]

    result = {
        'predictions': predictions.tolist(),
        'target_names': PLAN_TARGET_NAMES,
        'complex_er': complex_er_list,
        'engagement_rates': complex_er_list
    }
    if getattr(model, 'is_fallback', False):
        result['fallback'] = True
        result['fallback_reason'] = getattr(model, 'fallback_reason', 'missing_backend_or_load_error')
    return result


def main():
    """CLI entry point"""
    run_persistent = len(sys.argv) < 2 or (len(sys.argv) == 2 and sys.argv[1] == 'serve')

    if run_persistent:
        # Режим ожидания команд (persistent worker)
        print(json.dumps({"type": "ready"}))
        sys.stdout.flush()

        for line in sys.stdin:
            try:
                request = json.loads(line.strip())
                request_id = request.get('id')
                mode = request.get('mode')
                model_key = request.get('model_key')
                payload = request.get('payload', {})

                if mode == 'train':
                    features = payload.get('features', [])
                    targets = payload.get('targets', [])
                    feature_names = payload.get('feature_names', [])
                    version_info = {
                        'feature_set_version': payload.get('feature_set_version'),
                        'ontology_features_enabled': payload.get('ontology_features_enabled')
                    }

                    if model_key == 'post':
                        result = train_post_model(features, targets, feature_names, version_info)
                    elif model_key == 'content_plan':
                        result = train_plan_model(features, targets, feature_names, version_info)
                    else:
                        result = {'error': f'Unknown model_key: {model_key}'}

                    response = {"id": request_id, "success": True, "result": result}

                elif mode == 'predict':
                    features = payload.get('features', [])

                    if model_key == 'post':
                        result = predict_post_metrics(features)
                    elif model_key == 'content_plan':
                        result = predict_plan_metrics(features)
                    else:
                        result = {'error': f'Unknown model_key: {model_key}'}

                    response = {"id": request_id, "success": True, "result": result}

                else:
                    response = {"id": request_id, "success": False, "error": f"Unknown mode: {mode}"}

                print(json.dumps(response))
                sys.stdout.flush()

            except Exception as e:
                error_response = {
                    "id": request.get('id') if 'request' in locals() else None,
                    "success": False,
                    "error": str(e)
                }
                print(json.dumps(error_response))
                sys.stdout.flush()

    elif len(sys.argv) >= 3:
        # Режим одноразового вызова
        mode = sys.argv[1]
        model_key = sys.argv[2]

        input_data = json.loads(sys.stdin.read())

        if mode == 'train':
            features = input_data.get('features', [])
            targets = input_data.get('targets', [])
            feature_names = input_data.get('feature_names', [])
            version_info = {
                'feature_set_version': input_data.get('feature_set_version'),
                'ontology_features_enabled': input_data.get('ontology_features_enabled')
            }

            if model_key == 'post':
                result = train_post_model(features, targets, feature_names, version_info)
            elif model_key == 'content_plan':
                result = train_plan_model(features, targets, feature_names, version_info)
            else:
                result = {'error': f'Unknown model_key: {model_key}'}

            print(json.dumps(result))

        elif mode == 'predict':
            features = input_data.get('features', [])
            try:
                if model_key == 'post':
                    result = predict_post_metrics(features)
                elif model_key == 'content_plan':
                    result = predict_plan_metrics(features)
                else:
                    result = {'error': f'Unknown model_key: {model_key}'}
            except Exception as e:
                print(f"[ML] Warning: Predict failed for {model_key} ({e}). Generating calibrated emergency baseline.", file=sys.stderr)
                n_samples = max(1, len(features))
                target_names = PLAN_TARGET_NAMES if model_key == 'content_plan' else POST_TARGET_NAMES
                defaults = [350, 50, 30000] if model_key == 'content_plan' else [50, 5, 1200]
                fallback_preds = [defaults for _ in range(n_samples)]
                result = {
                    'predictions': fallback_preds,
                    'target_names': target_names,
                    'complex_er': [0.05 for _ in range(n_samples)],
                    'engagement_rates': [0.05 for _ in range(n_samples)],
                    'fallback': True,
                    'fallback_reason': str(e)
                }

            print(json.dumps(result))
    else:
        raise ValueError("Invalid CLI usage. Use: <no args|serve> for worker mode or <mode> <model_key> for one-shot mode.")


if __name__ == '__main__':
    main()