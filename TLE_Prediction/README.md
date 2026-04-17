# TLE Prediction

This folder holds the real data trajectory prediction workflow.

## What belongs here

- `data/88_most_recent_satellites_LEO.csv`
  - real TLE dataset used for offline preparation and training input
- `models/mldsgp4_best_model.pth`
  - trained offline model file
- `predict_trajectory.py`
  - runtime inference script used by the web app
- `build_training_pairs.py`
  - converts raw CSV rows into consecutive TLE training pairs

## Runtime contract

The web app does not train the model at runtime.

At runtime it only:

1. loads the existing `.pth` file
2. accepts one real TLE
3. predicts forward in hourly steps
4. returns state vectors for up to 10 days (`240` hours)

## Expected model location

Place the trained model at:

`TLE_Prediction/models/mldsgp4_best_model.pth`

## Python dependencies

Install them in the Python environment used by the SvelteKit server:

```bash
pip install -r TLE_Prediction/requirements.txt
```

## Notes

- The inference code stays close to the team Colab flow.
- One important fix is applied in state unnormalization:
  - position uses `state[:, :3]`
  - velocity uses `state[:, 3:]`
