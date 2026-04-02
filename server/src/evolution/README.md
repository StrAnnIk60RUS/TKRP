# Evolution Module

This folder contains the evolution/GA module in one place so it can be extracted and worked on separately.

## Files

- `index.js` - public exports for evolution module
- `gaCore.js` - generic GA engine (selection, crossover/mutation loop, stop conditions)
- `operators.js` - crossover/mutation helpers
- `postMetricsPredictionService.js` - train/predict bridge to Python model
- `hierarchicalGa.js` - current hierarchical optimization entrypoint
- `ontology/characteristics.json` - ontology feature schema
- `ontology/ontologyLoader.js` - JSON loader for ontology schema

## Ontology Source of Truth

Ontology feature dimension and tone labels are loaded from:

- `server/src/evolution/ontology/characteristics.json`

The Python model (`server/ml/post_metrics_model.py`) also reads this JSON to keep feature dimensions in sync.

