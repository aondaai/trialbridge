# TrialBridge feasibility estimator (FastAPI + DuckDB over OMOP parquet).
# Data is NOT baked in — it is mounted read-only at runtime (see the web app's
# docker-compose.yml). TB_DATASUS_DIR / TB_PROPRIETARY_GLOB point at the mounts.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Sample data is baked in (see .dockerignore — omop_full is excluded). Point the
# estimator at the in-image sample so no host bind mount is needed.
# concept-map.json is baked in at the build-context root (/app); the shared
# resolver (trialbridge/concept_map.py) reads it via TB_CONCEPT_MAP.
# api.py serves from the MATERIALIZED base (data/datasus_base, tiny/committed) via
# MaterializedDataSUS, and proprietary depth from data/proprietary_ha — no 163GB scan.
ENV TB_DATASUS_BASE_DIR=/app/data/datasus_base \
    TB_PROPRIETARY_GLOB=/app/data/proprietary_ha/*.parquet \
    TB_CONCEPT_MAP=/app/concept-map.json

EXPOSE 8421

# Bind to the port Render injects ($PORT); fall back to 8421 for local docker.
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8421}"]
