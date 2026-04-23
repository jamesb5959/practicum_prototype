# Practicum LEO Prototype

## Current Stack

- Frontend: Svelte 5, SvelteKit, Vite
- Globe and orbit rendering: CesiumJS
- Orbit propagation: `satellite.js` / SGP4
- Authentication: local Keycloak 
- Runtime prediction bridge: SvelteKit server route calling Python
- Offline / model assets: `dsgp4`, PyTorch, `.pth` model in `TLE_Prediction/`

## Current Data Sources

### Live app catalog

- `static/data/88_most_recent_satellites_LEO.csv`
- Loaded by [src/lib/tle.ts](src/lib/tle.ts)
- Displayed in:
  - [src/routes/dashboard/+page.svelte](src/routes/dashboard/+page.svelte)
  - [src/routes/space_view/+page.svelte](src/routes/space_view/+page.svelte)

### Prediction model assets

- `TLE_Prediction/data/88_most_recent_satellites_LEO.csv`
- `TLE_Prediction/models/mldsgp4_best_model.pth`

### Important note

The repository still contains some old NASA sample TLE files under `static/data/`, but the current app does not use them for the live.

## Authentication

Login is handled by the local Keycloak server in `keycloak-server/`.

Default local demo values:

- Keycloak base URL: `http://localhost:8080`
- App base URL: `http://localhost:5173`
- Realm: `demo`
- Client ID: `svelte-web`

Default demo realm user:

- Username: `admin`
- Password: `Admin123!`

The SvelteKit app uses a server-side flow and stores auth state in secure cookies.

## Environment

Copy the app env file if you want to override defaults:

```bash
cp .env.example .env
```

Common values:

- `APP_BASE_URL=http://localhost:5173`
- `KEYCLOAK_BASE_URL=http://localhost:8080`
- `KEYCLOAK_INTERNAL_URL=http://localhost:8080`
- `KEYCLOAK_REALM=demo`
- `KEYCLOAK_CLIENT_ID=svelte-web`
- `KEYCLOAK_DIRECT_LOGIN=false`
- `TLE_PREDICTION_PYTHON=python3`
- `TLE_PREDICTION_MODEL_PATH=./TLE_Prediction/models/mldsgp4_best_model.pth`

## Setup

Prerequisites:

- Node.js 18+
- Python 3
- Docker 

Bootstrap the project:

```bash
chmod +x setup.sh
./setup.sh
```

What `setup.sh` does now:

1. installs Node dependencies
2. validates that the Warpcore CSV exists in `static/data/`
3. validates that the prediction model exists in `TLE_Prediction/models/`
4. installs Python dependencies for `TLE_Prediction/`
5. makes sure local texture/data folders exist

## Running Locally

### 1. Start Keycloak

```bash
cd keycloak-server
cp .env.example .env
docker compose up -d
```

### 2. Start the app

```bash
cd <repo-root>
./start.sh
```

or directly:

```bash
npm run dev
```

App URL:

- [http://localhost:5173](http://localhost:5173)

Keycloak admin:

- [http://localhost:8080/admin](http://localhost:8080/admin)

## Running With Docker Only

### Docker files used

- [Dockerfile](Dockerfile)
  - app image with Node, Python, runtime model assets, and SvelteKit build output
- [docker-compose.full.yml](docker-compose.full.yml)
  - full stack for app + Keycloak + Postgres
- [.env.docker.example](.env.docker.example)
  - app env defaults for the Docker stack
- [setup-docker.sh](setup-docker.sh)
  - Docker bootstrap / validation / image build
- [start-docker.sh](start-docker.sh)
  - Docker stack startup

### 1. Docker bootstrap

```bash
chmod +x setup-docker.sh start-docker.sh
./setup-docker.sh
```

What `setup-docker.sh` does:

1. validates that the Warpcore CSV exists in `static/data/`
2. validates that the current model exists in `TLE_Prediction/models/`
3. copies `static/data/88_most_recent_satellites_LEO.csv` into `TLE_Prediction/data/` if needed
4. copies `.env.docker.example` to `.env.docker` if needed
5. copies `keycloak-server/.env.example` to `keycloak-server/.env` if needed
6. builds the full Docker stack images

### 2. Start the Docker stack

```bash
./start-docker.sh up
```

This starts:

- the SvelteKit app
- the embedded Python prediction runtime inside the app container
- Keycloak
- Postgres for Keycloak

URLs:

- App: [http://localhost:5173](http://localhost:5173)
- Keycloak: [http://localhost:8080](http://localhost:8080)
- Keycloak admin: [http://localhost:8080/admin](http://localhost:8080/admin)

To stop or reset the Docker stack:

```bash
./start-docker.sh down
./start-docker.sh reset
```

## How the App Works

### Dashboard

The dashboard gives a high level summary:

- live object count
- data source label
- collision/conjunction summary
- quick launch into Space View

Main file:

- [src/routes/dashboard/+page.svelte](src/routes/dashboard/+page.svelte)

### Space View

Space View renders the current catalog on the Cesium globe and lets the user:

- filter by orbit band
- toggle trajectory lines
- inspect per-object telemetry
- see conjunction anomalies
- view expected closest approach and event time

Main file:

- [src/routes/space_view/+page.svelte](src/routes/space_view/+page.svelte)

### Trajectory rendering

The visible trajectory lines are currently rendered from direct SGP4 propagation using the current TLE state. This is the live on screen path.

### Collision screening

Conjunction screening is done locally in the frontend/shared logic by propagating satellites forward over the configured horizon and checking pairwise separation against a threshold.

Relevant files:

- [src/lib/conjunction.ts](src/lib/conjunction.ts)
- [src/lib/collisionUtils.ts](src/lib/collisionUtils.ts)

### Prediction pipeline

The Python prediction path still exists for model backed trajectory work and API integration, but the live visible trajectory line in Space View is currently SGP4 rendered for stability and alignment.

Relevant files:

- [src/lib/server/tlePrediction.ts](src/lib/server/tlePrediction.ts)
- [src/routes/api/tle-prediction/+server.ts](src/routes/api/tle-prediction/+server.ts)
- [TLE_Prediction/predict_trajectory.py](TLE_Prediction/predict_trajectory.py)

## Detailed Project Structure

### Repository root

- [README.md](README.md)
  - project overview 
- [package.json](package.json)
  - Node dependencies and app scripts
- [setup.sh](setup.sh)
  - local bootstrap / validation
- [start.sh](start.sh)
  - convenience script for `npm run dev`
- [setup-docker.sh](setup-docker.sh)
  - Docker bootstrap / validation / image build
- [start-docker.sh](start-docker.sh)
  - Docker stack startup
- [.env.example](.env.example)
  - example environment values for the SvelteKit app
- [.env.docker.example](.env.docker.example)
  - example environment values for the Dockerized app flow
- [Dockerfile](Dockerfile)
  - app image definition with Node + Python runtime
- [docker-compose.full.yml](docker-compose.full.yml)
  - full Docker stack for app + Keycloak + Postgres
- [.dockerignore](.dockerignore)
  - Docker build exclusions for local-only and generated files

### `src/`

Application source code.

#### `src/lib/`

- [src/lib/tle.ts](src/lib/tle.ts)
  - parses `88_most_recent_satellites_LEO.csv`
  - converts CSV rows to TLE triplets
  - exposes propagation helpers
- [src/lib/conjunction.ts](src/lib/conjunction.ts)
  - conjunction configuration
  - closest-approach detection
  - active conjunction store
- [src/lib/collisionUtils.ts](src/lib/collisionUtils.ts)
  - helpers for matching conjunction events to satellites
- [src/lib/classification.ts](src/lib/classification.ts)
  - app side classification state used by the top banner
- [src/lib/auth.ts](src/lib/auth.ts)
  - legacy/local auth utility, current real login is Keycloak
- [src/lib/sample.tle](src/lib/sample.tle)
  - sample TLE asset kept in repo

#### `src/lib/server/`

- [src/lib/server/keycloak.ts](src/lib/server/keycloak.ts)
  - login/callback/logout helpers
  - supports separate public and internal Keycloak URLs for Dockerized deployment
- [src/lib/server/tlePrediction.ts](src/lib/server/tlePrediction.ts)
  - Python bridge for runtime prediction
  - model warmup
  - prediction cache

#### `src/routes/`

- [src/routes/+layout.svelte](src/routes/+layout.svelte)
  - shared app layout and top classification bar
- [src/routes/+page.svelte](src/routes/+page.svelte)
  - root landing route

##### Auth routes

- [src/routes/login/+page.server.ts](src/routes/login/+page.server.ts)
  - redirects `/login` into the auth flow
- [src/routes/login/+page.svelte](src/routes/login/+page.svelte)
  - login page view
- [src/routes/auth/login/+server.ts](src/routes/auth/login/+server.ts)
  - starts OIDC login
- [src/routes/auth/callback/+server.ts](src/routes/auth/callback/+server.ts)
  - handles callback
- [src/routes/auth/logout/+server.ts](src/routes/auth/logout/+server.ts)
  - clears app session and logs out

##### Main app routes

- [src/routes/dashboard/+page.svelte](src/routes/dashboard/+page.svelte)
  - dashboard
- [src/routes/dashboard/+page.ts](src/routes/dashboard/+page.ts)
  - route metadata/load support
- [src/routes/space_view/+page.svelte](src/routes/space_view/+page.svelte)
  - Cesium globe, filters, trajectories, selectedobject panel, anomaly markers
- [src/routes/space_view/+page.ts](src/routes/space_view/+page.ts)

##### API routes

- [src/routes/api/tle-prediction/+server.ts](src/routes/api/tle-prediction/+server.ts)
  - runtime prediction endpoint

### `static/`

#### `static/data/`

- [static/data/88_most_recent_satellites_LEO.csv](static/data/88_most_recent_satellites_LEO.csv)
  - current live Warpcore data used by the app
- [static/data/nasa-leo.sample.tle](static/data/nasa-leo.sample.tle)
  - legacy sample file
- [static/data/nasa-leo.tle](static/data/nasa-leo.tle)
  - legacy file not used by the current app
- [static/data/nasa-debris.sample.tle](static/data/nasa-debris.sample.tle)
  - legacy sample debris file
- [static/data/nasa-debris.tle](static/data/nasa-debris.tle)
  - legacy debris file not used by the current app

#### `static/textures/`

- [static/textures/earth.jpg](static/textures/earth.jpg)
  - globe texture used by Cesium
- [static/textures/earth.png](static/textures/earth.png)
  - icon/texture fallback used by app assets

### `TLE_Prediction/`

- [TLE_Prediction/README.md](TLE_Prediction/README.md)
  - prediction specific documentation
- [TLE_Prediction/predict_trajectory.py](TLE_Prediction/predict_trajectory.py)
  - runtime inference script
- [TLE_Prediction/build_training_pairs.py](TLE_Prediction/build_training_pairs.py)
  - offline training pair preparation
- [TLE_Prediction/requirements.txt](TLE_Prediction/requirements.txt)
  - Python dependencies

#### `TLE_Prediction/data/`

- [TLE_Prediction/data/88_most_recent_satellites_LEO.csv](TLE_Prediction/data/88_most_recent_satellites_LEO.csv)
  - local copy of the Warpcore dataset
- [TLE_Prediction/data/100_most_recent_satellites.csv](TLE_Prediction/data/100_most_recent_satellites.csv)
  - older reference dataset kept in repo

#### `TLE_Prediction/models/`

- [TLE_Prediction/models/mldsgp4_best_model.pth](TLE_Prediction/models/mldsgp4_best_model.pth)
  - current model used by the runtime
- [TLE_Prediction/models/mldsgp4_example_model.pth](TLE_Prediction/models/mldsgp4_example_model.pth)
  - older example model kept in repo

#### `TLE_Prediction/cache/`

### `keycloak-server/`

- [keycloak-server/docker-compose.yml](keycloak-server/docker-compose.yml)
  - Keycloak + Postgres local stack
- [keycloak-server/.env.example](keycloak-server/.env.example)
  - demo Keycloak / Postgres env values
- [keycloak-server/README.md](keycloak-server/README.md)
  - auth server setup notes
- [keycloak-server/realm/demo-realm.json](keycloak-server/realm/demo-realm.json)
  - local realm import
- [keycloak-server/themes/leo/](keycloak-server/themes/leo/login/theme.properties)
  - custom Keycloak login/account themes

### `scripts/`

- [scripts/fetch_nasa_tle.mjs](scripts/fetch_nasa_tle.mjs)
  - legacy script from the earlier NASA based work flow
  - not part of the current live app
