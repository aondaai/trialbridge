"""Access gate for the estimator API — optional shared-secret bearer token.

When `TB_ESTIMATOR_TOKEN` is UNSET the gate is disabled and the service stays open
(local dev, and the pre-rollout deploy — so enabling the gate is a zero-downtime
two-step: ship this code, then set the env var on the estimator + the web app that
calls it). When SET, every endpoint that depends on `require_token` requires
`Authorization: Bearer <token>`; wire /health WITHOUT the dependency so Render's
health check keeps passing.

The token is read from the environment per request (not cached at import), which keeps
the function trivially testable and lets a freshly-set env var take effect on the next
request without an import dance. Constant-time comparison avoids leaking the token via
response timing.
"""
from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException


def configured_token() -> str:
    return os.environ.get("TB_ESTIMATOR_TOKEN", "").strip()


def require_token(authorization: Optional[str] = Header(default=None)) -> None:
    token = configured_token()
    if not token:
        return  # gate disabled — open (no token configured)
    expected = f"Bearer {token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=401, detail="unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )
