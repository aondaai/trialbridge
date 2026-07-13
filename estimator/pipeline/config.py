"""Loads persisted CMA agent/environment IDs from env (control plane created once via `ant`)."""
from __future__ import annotations
import os

_VARS = {
    "intake": "TB_INTAKE_AGENT_ID",
    "proprietary": "TB_PROPRIETARY_AGENT_ID",
    "datasus_enrich": "TB_DATASUS_AGENT_ID",
    "environment": "TB_PIPELINE_ENV_ID",
}

def load_agent_ids() -> dict[str, str]:
    out = {}
    for key, var in _VARS.items():
        val = os.environ.get(var)
        if not val:
            raise RuntimeError(f"missing env var {var} — create agents via `ant beta:agents "
                               f"create < pipeline/agents/*.agent.yaml` and export the IDs")
        out[key] = val
    return out

def load_site_selection_agent_ids() -> dict[str, str]:
    """Selection is deployed independently so legacy cohort runs do not require its ID."""
    agent = os.environ.get("TB_SITE_SELECTION_AGENT_ID")
    environment = os.environ.get("TB_PIPELINE_ENV_ID")
    if not agent or not environment:
        raise RuntimeError("missing TB_SITE_SELECTION_AGENT_ID or TB_PIPELINE_ENV_ID")
    return {"site_selection": agent, "environment": environment}
