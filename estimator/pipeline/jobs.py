"""Durable, idempotent job storage for Sponsor Flow -> CMA executions.

Only protocol text, reviewed criteria, aggregate outputs, and CMA identifiers are
stored here. Patient rows are neither accepted nor representable in this schema.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


RunStatus = Literal[
    "queued", "intake_running", "proprietary_running", "datasus_running",
    "complete", "partial", "failed",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CmaRunRequest(BaseModel):
    consultation_id: str = Field(min_length=1, max_length=200)
    nct: str = Field(pattern=r"^(NCT\d{8}|UNREGISTERED)$")
    protocol_text: str = Field(min_length=1, max_length=500_000)
    verified_criteria: list[dict] = Field(min_length=1, max_length=500)
    criteria_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    elasticsearch_plan: dict | None = None
    dx: dict = Field(default_factory=dict)


class CmaRunRecord(BaseModel):
    id: str
    consultation_id: str
    criteria_hash: str
    status: RunStatus
    current_stage: str
    request: CmaRunRequest
    result: dict | None = None
    error: str | None = None
    created_at: str
    updated_at: str


class CmaRunView(BaseModel):
    """Public status projection; deliberately excludes protocol text and criteria."""
    id: str
    consultation_id: str
    criteria_hash: str
    status: RunStatus
    current_stage: str
    result: dict | None = None
    error: str | None = None
    created_at: str
    updated_at: str


class CmaJobStore:
    """Small SQLite queue suitable for the estimator's single-worker deployment."""

    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cma_runs (
                    id TEXT PRIMARY KEY,
                    consultation_id TEXT NOT NULL,
                    criteria_hash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    current_stage TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    result_json TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(consultation_id, criteria_hash)
                )
                """
            )

    @staticmethod
    def _record(row: sqlite3.Row) -> CmaRunRecord:
        return CmaRunRecord(
            id=row["id"], consultation_id=row["consultation_id"],
            criteria_hash=row["criteria_hash"], status=row["status"],
            current_stage=row["current_stage"],
            request=json.loads(row["request_json"]),
            result=json.loads(row["result_json"]) if row["result_json"] else None,
            error=row["error"], created_at=row["created_at"], updated_at=row["updated_at"],
        )

    def create_or_get(self, request: CmaRunRequest) -> tuple[CmaRunRecord, bool]:
        now = _now()
        run_id = f"cma_run_{uuid.uuid4().hex}"
        with self._connect() as conn:
            try:
                conn.execute(
                    "INSERT INTO cma_runs "
                    "(id, consultation_id, criteria_hash, status, current_stage, request_json, "
                    "result_json, error, created_at, updated_at) "
                    "VALUES (?, ?, ?, 'queued', 'queued', ?, NULL, NULL, ?, ?)",
                    (run_id, request.consultation_id, request.criteria_hash,
                     request.model_dump_json(), now, now),
                )
                created = True
            except sqlite3.IntegrityError:
                created = False
            row = conn.execute(
                "SELECT * FROM cma_runs WHERE consultation_id=? AND criteria_hash=?",
                (request.consultation_id, request.criteria_hash),
            ).fetchone()
        assert row is not None
        return self._record(row), created

    def get(self, run_id: str) -> CmaRunRecord | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM cma_runs WHERE id=?", (run_id,)).fetchone()
        return self._record(row) if row else None

    def claim(self, run_id: str) -> bool:
        now = _now()
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE cma_runs SET status='intake_running', current_stage='intake_running', "
                "updated_at=? WHERE id=? AND status='queued'",
                (now, run_id),
            )
        return cursor.rowcount == 1

    def requeue_failed(self, run_id: str) -> bool:
        now = _now()
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE cma_runs SET status='queued', current_stage='queued', result_json=NULL, "
                "error=NULL, updated_at=? WHERE id=? AND status='failed'",
                (now, run_id),
            )
        return cursor.rowcount == 1

    def update(self, run_id: str, status: RunStatus, *, result: dict | None = None,
               error: str | None = None) -> None:
        now = _now()
        with self._connect() as conn:
            conn.execute(
                "UPDATE cma_runs SET status=?, current_stage=?, result_json=?, error=?, updated_at=? WHERE id=?",
                (status, status, json.dumps(result) if result is not None else None,
                 error, now, run_id),
            )

    def recover_interrupted(self) -> list[str]:
        """Requeue non-terminal work after a process restart and return queued IDs."""
        now = _now()
        active = ("intake_running", "proprietary_running", "datasus_running")
        with self._connect() as conn:
            conn.execute(
                f"UPDATE cma_runs SET status='queued', current_stage='queued', updated_at=? "
                f"WHERE status IN ({','.join('?' for _ in active)})",
                (now, *active),
            )
            rows = conn.execute("SELECT id FROM cma_runs WHERE status='queued'").fetchall()
        return [row["id"] for row in rows]
