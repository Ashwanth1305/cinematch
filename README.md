# CineMatch

CineMatch is a full-stack movie discovery and recommendation platform. It
combines live movie metadata from TMDB, user taste and streaming-platform
preferences, rule-based recommendations, and an optional two-stage machine
learning ranking service.

The application is designed around Indian streaming audiences and supports
providers such as Netflix, Prime Video, Hotstar, JioCinema, Zee5, SonyLIV,
Apple TV+, and Lionsgate Play.

## Features

- Account creation, sign-in, and persistent sessions
- Onboarding for OTT subscriptions and movie preferences
- Personalized home and recommendation feeds
- Movie and TV discovery through TMDB
- Search, watchlists, feedback, and taste-profile management
- Streaming-provider availability for the India region
- Shareable movie pages
- Graceful rule-based fallback when the ML service is unavailable
- Hybrid ML ranking with LightFM and XGBoost

## Architecture

```text
Browser
   |
   v
Next.js application (port 3000)
   |-- TMDB API for movie metadata and provider availability
   |-- Local development data store in cinematch/.data
   |
   +--> FastAPI ML service (port 8000)
          |-- LightFM candidate scoring
          |-- XGBRanker re-ranking
          `-- 60% rule score + 40% model score
```

| Component | Technology | Purpose |
| --- | --- | --- |
| Web application | Next.js 16, React 19 | UI, authentication, application APIs, and rule-based recommendations |
| Movie data | TMDB API | Live titles, images, search results, and streaming providers |
| ML API | FastAPI, Pydantic, Uvicorn | Recommendation inference over HTTP |
| Candidate model | LightFM | Hybrid collaborative and content-based scoring |
| Re-ranker | XGBoost `XGBRanker` | Learning-to-rank over movie, user, and rule-based features |
| Local persistence | JSON files | Development-only users, sessions, preferences, and activity |

## Repository Structure

```text
CineMatch/
├── cinematch/              # Next.js web application
│   ├── src/app/            # Pages and API routes
│   ├── src/lib/            # TMDB, auth, storage, and ML clients
│   └── database/schema.sql # Reference relational schema
├── ml-service/             # Python recommendation service
│   ├── src/                # Training, evaluation, inference, and API code
│   └── tests/              # ML unit tests
├── dataset/                # Local training data; excluded from Git
└── README.md               # Project documentation
```

## Prerequisites

- Node.js 20.9 or newer
- npm
- A TMDB API key or TMDB read-access token
- Python 3.11 for the optional ML service
- Conda or another Python virtual-environment manager

The web application can run without the ML service. Training the models also
requires the local CineMatch dataset, which is not included in this repository.

## Quick Start

### 1. Configure and run the web application

Install the JavaScript dependencies:

```bash
cd cinematch
npm install
```

Create `cinematch/.env.local` and add one of the two TMDB credentials:

```dotenv
# Use either an API key...
TMDB_API_KEY=your_tmdb_api_key

# ...or a read-access token.
# TMDB_READ_ACCESS_TOKEN=your_tmdb_read_access_token

ML_SERVICE_URL=http://127.0.0.1:8000
ML_SERVICE_TIMEOUT=5000
```

Never commit `.env.local` or paste a real credential into documentation.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 2. Set up the optional ML service

From the repository root:

```bash
conda create -n cinematch-ml python=3.11 -y
conda activate cinematch-ml
cd ml-service
pip install -r requirements.txt
pip install lightfm==1.17
```

The service configuration is documented in `ml-service/.env.example`. Copy it
only if you need to override the defaults:

```bash
cp .env.example .env
```

### 3. Provide data and train the models

Place the private training files under:

```text
dataset/cinematch_combined/
```

Expected inputs:

| File | Description |
| --- | --- |
| `combined_movies.csv` | Movie titles, genres, languages, cast, and crew |
| `combined_users.csv` | User metadata used to build user features |
| `data_dictionary.csv` | Source-column documentation |
| `part_aa_with_header.csv` through `part_af_with_header.csv` | Partitioned interaction and rating data |

Train and evaluate the models:

```bash
cd ml-service
conda activate cinematch-ml
python -m src.train
```

Generated models, mappings, feature matrices, evaluation reports, and training
logs are written to `ml-service/artifacts/`. Both the dataset and artifacts are
excluded from Git because they are private and/or too large for a normal GitHub
repository.

### 4. Run the ML API

After training or restoring the model artifacts:

```bash
cd ml-service
conda activate cinematch-ml
python -m uvicorn src.api:app --host 127.0.0.1 --port 8000
```

Verify the service:

```bash
curl http://127.0.0.1:8000/health
```

A fully loaded service reports:

```json
{
  "status": "ok",
  "lightfm_loaded": true,
  "xgb_loaded": true
}
```

If model artifacts are absent, the service starts in fallback mode and reports
the unavailable models as `false`. The Next.js application also falls back to
its rule-based recommendation flow when it cannot reach the ML API.

## Recommendation Pipeline

The training and inference flow is:

1. Load ratings plus movie and user metadata.
2. Build user, item, genre, language, cast, and director features.
3. Split interactions per user into training, validation, and test sets.
4. Train LightFM with WARP loss for hybrid candidate scoring.
5. Generate positive and synthetic negative ranking examples.
6. Train XGBRanker over model, content, popularity, and rule-based features.
7. Normalize the model result and blend it with the rule score:

```text
final score = 0.60 × rule score + 0.40 × model score
```

8. Sort candidates by the final score and return the top results.

## ML API

FastAPI exposes interactive documentation at
[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) while the service is
running.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Reports API and model availability |
| `GET` | `/model-info` | Returns model metadata, features, and hybrid weights |
| `POST` | `/recommendations` | Re-ranks a collection of movie candidates |
| `POST` | `/hybrid-score` | Scores one user/movie pair |

## Development Commands

Run these commands from `cinematch/`:

```bash
npm run dev
npm run lint
npm run build
npm run start
```

Run the Python tests from `ml-service/` with the ML environment active:

```bash
pytest tests/ -v
```

## Data and Security

The root `.gitignore` excludes:

- API keys and local environment files
- Local users, password hashes, session tokens, watchlists, and activity data
- Raw and processed training datasets
- Trained models and generated ML artifacts
- Build output, dependency folders, caches, logs, and editor files

Only sanitized environment templates should be committed. If a secret is ever
committed, remove it from Git history and rotate it with the provider; adding it
to `.gitignore` afterward is not sufficient.

The JSON data store under `cinematch/.data/` is intended only for local
development. A production deployment should use a managed database, a dedicated
session store, restricted CORS origins, HTTPS, and platform-managed secrets.

## Deployment Notes

- Deploy the Next.js application and FastAPI service as separate processes.
- Set `ML_SERVICE_URL` in the web service to the reachable ML API URL.
- Store model artifacts in secured object storage or a mounted deployment
  volume instead of Git.
- Keep TMDB credentials and service configuration in the hosting platform's
  secret manager.
- Replace the local JSON store before accepting production users.
