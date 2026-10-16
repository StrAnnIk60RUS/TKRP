# Session state: engagement_model.py sklearn fix

## Status: IN PROGRESS

## Problem
Optimization run failed: `engagement_model.py predict content_plan` exited 1 with
`ModuleNotFoundError: No module named 'sklearn'` at `tools/ml/engagement_model.py` line 4.

## Root cause (confirmed)
- `PYTHON_BIN=python` (`.env.example:22`) -> system Python 3.11.9.
- That interpreter has `numpy` but NOT `scikit-learn` and NOT `joblib`.
- `requirements.txt` already lists `scikit-learn>=1.3.0` and `joblib>=1.3.0` — the env was never (fully) pip-installed.

## Plan / steps
1. [done] Reproduce: `python -c "import sklearn"` -> ModuleNotFoundError; `import joblib` -> same.
2. [next] `pip install scikit-learn joblib` (versions per requirements.txt).
3. [next] Verify: `python -c "import sklearn, joblib"`; then run `engagement_model.py predict content_plan` path or `npm run ml:retrain` if artifacts stale.
4. [next] Check `data/ml/*.joblib` feature dimension alignment if predictions behave oddly (AGENTS.md gotcha).

## For next agent
If step 2+ already done and verification passed, mark this file DONE and remove it.
