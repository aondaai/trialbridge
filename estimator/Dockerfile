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
ENV TB_DATASUS_DIR=/app/data/omop_sample \
    TB_PROPRIETARY_GLOB=/app/data/proprietary_ha/*.parquet

EXPOSE 8421

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8421"]
