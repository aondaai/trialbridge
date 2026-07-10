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
ENV TB_DATASUS_DIR=/app/data/omop_sample \
    TB_PROPRIETARY_GLOB=/app/data/proprietary_ha/*.parquet \
    TB_CONCEPT_MAP=/app/concept-map.json

EXPOSE 8421

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8421"]
