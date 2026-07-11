"""Access-gate tests — the require_token dependency in isolation (no data layer)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import HTTPException

from trialbridge.auth import require_token


def test_open_when_token_unset(monkeypatch):
    monkeypatch.delenv("TB_ESTIMATOR_TOKEN", raising=False)
    assert require_token(authorization=None) is None
    assert require_token(authorization="Bearer anything") is None


def test_missing_header_rejected_when_gated(monkeypatch):
    monkeypatch.setenv("TB_ESTIMATOR_TOKEN", "s3cret")
    with pytest.raises(HTTPException) as e:
        require_token(authorization=None)
    assert e.value.status_code == 401
    assert e.value.headers.get("WWW-Authenticate") == "Bearer"


def test_correct_bearer_passes(monkeypatch):
    monkeypatch.setenv("TB_ESTIMATOR_TOKEN", "s3cret")
    assert require_token(authorization="Bearer s3cret") is None


def test_wrong_bearer_rejected(monkeypatch):
    monkeypatch.setenv("TB_ESTIMATOR_TOKEN", "s3cret")
    with pytest.raises(HTTPException):
        require_token(authorization="Bearer nope")


def test_scheme_must_be_bearer(monkeypatch):
    monkeypatch.setenv("TB_ESTIMATOR_TOKEN", "s3cret")
    with pytest.raises(HTTPException):
        require_token(authorization="s3cret")           # bare token, no scheme
    with pytest.raises(HTTPException):
        require_token(authorization="Basic s3cret")     # wrong scheme


def test_whitespace_only_token_is_treated_as_unset(monkeypatch):
    monkeypatch.setenv("TB_ESTIMATOR_TOKEN", "   ")
    assert require_token(authorization=None) is None  # stays open
