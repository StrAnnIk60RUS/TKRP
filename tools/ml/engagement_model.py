import sys
import json
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.neural_network import MLPRegressor
from sklearn.multioutput import MultiOutputRegressor
import joblib
import os
from pathlib import Path

# Конфигурация
MODEL_DIR = Path(os.environ.get('ML_MODEL_DIR', 'data/ml'))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Имена целевых метрик
POST_TARGET_NAMES = ['likes', 'shares', 'views']
PLAN_TARGET_NAMES = ['total_likes', 'total_shares', 'total_views']


def log_transform(values):
    """log1p трансформация для неотрицательных данных"""
    return np.log1p(np.maximum(values, 0))


def exp_transform(values):
    """expm1 обратная трансформация"""
    return np.expm1(values)


class MultiMetricPredictor:
    """Multi-output регрессор для предсказания нескольких метрик"""

    def __init__(self, target_names, hidden_layer_sizes=(128, 64), max_iter=500, random_state=42):
        self.target_names = target_names
        self.n_targets = len(target_names)

        base_mlp = MLPRegressor(
            hidden_layer_sizes=hidden_layer_sizes,
            activation='relu',
            solver='adam',
            max_iter=max_iter,
            random_state=random_state,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=20,
            verbose=False
        )

        self.model = MultiOutputRegressor(base_mlp, n_jobs=1)
        self.scaler_X = StandardScaler()
        self.scaler_y = StandardScaler()
        self._is_fitted = False

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
        # 1. Масштабируем признаки
        X_scaled = self.scaler_X.fit_transform(X)

        # 2. Fit scaler_y на log1p данных И сразу transform
        y_scaled = self.fit_preprocess_y(y)

        # 3. Обучаем модель
        self.model.fit(X_scaled, y_scaled)
        self._is_fitted = True
        return self

    def predict(self, X):
        """Возвращает предсказания в原始 шкале (не log, не нормализованные)"""
        if not self._is_fitted:
            raise RuntimeError("Model must be fitted before predict")

        X_scaled = self.preprocess_X(X)
        y_pred_scaled = self.model.predict(X_scaled)
        y_denorm = self.scaler_y.inverse_transform(y_pred_scaled)

        y_result = np.zeros_like(y_denorm)
        for i in range(self.n_targets):
            y_result[:, i] = exp_transform(y_denorm[:, i])

        return y_result

    def save(self, model_path, metadata_path):
        """Сохраняет модель и метаданные"""
        joblib.dump({
            'model': self.model,
            'scaler_X': self.scaler_X,
            'scaler_y': self.scaler_y,
            'target_names': self.target_names,
            'is_fitted': self._is_fitted
        }, model_path)

        metadata = {
            'target_names': self.target_names,
            'n_targets': self.n_targets,
            'model_type': 'MultiOutputRegressor(MLPRegressor)',
            'feature_names': None
        }
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

    @classmethod
    def load(cls, model_path):
        """Загружает модель"""
        data = joblib.load(model_path)
        instance = cls(target_names=data['target_names'])
        instance.model = data['model']
        instance.scaler_X = data['scaler_X']
        instance.scaler_y = data['scaler_y']
        instance._is_fitted = data.get('is_fitted', True)
        return instance


def train_post_model(features, targets, feature_names=None):
    """Обучение модели для постов"""
    X = np.array(features)
    y = np.array(targets)

    print(f"[ML] Training post model: X.shape={X.shape}, y.shape={y.shape}", file=sys.stderr)

    model = MultiMetricPredictor(target_names=POST_TARGET_NAMES)
    model.fit(X, y)

    model_path = MODEL_DIR / 'post_metrics_model.joblib'
    metadata_path = MODEL_DIR / 'post_metrics_model_metadata.json'
    model.save(model_path, metadata_path)

    if feature_names:
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        metadata['feature_names'] = feature_names
        metadata['n_features'] = len(feature_names)

        # Добавляем статистику по таргетам
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


def train_plan_model(features, targets, feature_names=None):
    """Обучение модели для планов"""
    X = np.array(features)
    y = np.array(targets)

    print(f"[ML] Training plan model: X.shape={X.shape}, y.shape={y.shape}", file=sys.stderr)

    model = MultiMetricPredictor(target_names=PLAN_TARGET_NAMES)
    model.fit(X, y)

    model_path = MODEL_DIR / 'plan_metrics_model.joblib'
    metadata_path = MODEL_DIR / 'plan_metrics_model_metadata.json'
    model.save(model_path, metadata_path)

    if feature_names:
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        metadata['feature_names'] = feature_names
        metadata['n_features'] = len(feature_names)

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


def predict_post_metrics(features):
    """Предсказание метрик для постов"""
    model_path = MODEL_DIR / 'post_metrics_model.joblib'

    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    model = MultiMetricPredictor.load(model_path)
    X = np.array(features)
    predictions = model.predict(X)
    predictions = np.round(predictions).astype(int)

    return {
        'predictions': predictions.tolist(),
        'target_names': POST_TARGET_NAMES
    }


def predict_plan_metrics(features):
    """Предсказание метрик для планов"""
    model_path = MODEL_DIR / 'plan_metrics_model.joblib'

    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    model = MultiMetricPredictor.load(model_path)
    X = np.array(features)
    predictions = model.predict(X)
    predictions = np.round(predictions).astype(int)

    return {
        'predictions': predictions.tolist(),
        'target_names': PLAN_TARGET_NAMES
    }


def main():
    """CLI entry point"""
    if len(sys.argv) < 2:
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

                    if model_key == 'post':
                        result = train_post_model(features, targets, feature_names)
                    elif model_key == 'content_plan':
                        result = train_plan_model(features, targets, feature_names)
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

            if model_key == 'post':
                result = train_post_model(features, targets, feature_names)
            elif model_key == 'content_plan':
                result = train_plan_model(features, targets, feature_names)
            else:
                result = {'error': f'Unknown model_key: {model_key}'}

            print(json.dumps(result))

        elif mode == 'predict':
            features = input_data.get('features', [])

            if model_key == 'post':
                result = predict_post_metrics(features)
            elif model_key == 'content_plan':
                result = predict_plan_metrics(features)
            else:
                result = {'error': f'Unknown model_key: {model_key}'}

            print(json.dumps(result))


if __name__ == '__main__':
    main()