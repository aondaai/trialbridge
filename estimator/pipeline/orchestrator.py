"""Local orchestrator (data plane). Holds the SSE streams AND the PHI-touching tool handlers.
Row-level data never leaves these handlers — they return aggregate dicts only. Spec §3, §7."""
from __future__ import annotations
import os, json, re
from urllib.request import Request, urlopen
from datetime import date
from typing import Callable
from .schemas import SearchSpec, DataSUSCounts, ProprietaryCounts, FeasibilityPack
from .handlers.proprietary import search_proprietary
from .handlers.elasticsearch_proprietary import search_proprietary_elasticsearch
from .handlers.datasus import query_datasus, build_pack
from .demo_cases import (load_datasus_capture, load_proprietary_capture,
                         load_proprietary_inventory)
from .handlers.proprietary import _tier2_items
from .config import load_agent_ids, load_site_selection_agent_ids

# ---- Host-side custom-tool handlers. Each: (input_dict, ctx) -> aggregate dict. ----

def _h_search_proprietary(inp: dict, ctx: dict) -> dict:
    spec = SearchSpec.model_validate(inp["spec"])
    expected_nct = str(ctx.get("expected_nct") or spec.nct).upper()
    if spec.nct.upper() != expected_nct:
        raise ValueError(f"SearchSpec NCT {spec.nct} does not match locked NCT {expected_nct}")
    if ctx.get("proprietary_capture"):
        return load_proprietary_capture(
            ctx["proprietary_capture"], expected_nct=expected_nct,
            tier2_items=_tier2_items(spec),
        ).model_dump()
    if ctx.get("proprietary_inventory"):
        return load_proprietary_inventory(
            ctx["proprietary_inventory"], expected_nct=expected_nct,
            tier2_items=_tier2_items(spec),
        ).model_dump()
    as_of = date.fromisoformat(ctx["as_of"]) if ctx.get("as_of") else None
    backend = str(ctx.get("proprietary_backend") or "duckdb").lower()
    if backend == "elasticsearch":
        r = search_proprietary_elasticsearch(
            spec,
            url=ctx["elasticsearch_url"],
            index=ctx["elasticsearch_index"],
            as_of=as_of,
        )
    elif backend == "duckdb":
        r = search_proprietary(spec, parquet_glob=ctx["parquet_glob"],
                               reference_year=ctx.get("reference_year", 2025), as_of=as_of)
    else:
        raise ValueError(f"unsupported proprietary backend: {backend!r}")
    return r.model_dump()

def _h_query_datasus(inp: dict, ctx: dict) -> dict:
    spec = SearchSpec.model_validate(inp["spec"])
    expected_nct = str(ctx.get("expected_nct") or spec.nct).upper()
    if spec.nct.upper() != expected_nct:
        raise ValueError(f"SearchSpec NCT {spec.nct} does not match locked NCT {expected_nct}")
    if ctx.get("datasus_capture"):
        return load_datasus_capture(
            ctx["datasus_capture"], expected_nct=expected_nct,
        ).model_dump()
    return query_datasus(spec, datasus_dir=ctx["datasus_dir"]).model_dump()

def _h_build_pack(inp: dict, ctx: dict) -> dict:
    spec = SearchSpec.model_validate(inp["spec"])
    ds = DataSUSCounts.model_validate(inp["datasus"])
    prop = ProprietaryCounts.model_validate(inp["proprietary"])
    # depth_ratio is data-derived from prop.depth_ratios — never from the agent.
    return build_pack(spec, ds, prop, depth_ratio=None).model_dump()

def _h_site_shortlist(inp: dict, ctx: dict) -> dict:
    """Call the trusted TrialBridge selection service; the agent cannot supply scores."""
    consultation_id = str(inp.get("consultation_id") or "").strip()
    expected = str(ctx.get("expected_consultation_id") or consultation_id).strip()
    if not consultation_id:
        raise ValueError("consultation_id required")
    if consultation_id != expected:
        raise ValueError("consultation_id does not match the locked selection request")
    limit = int(inp.get("limit", 20))
    if limit < 1 or limit > 50:
        raise ValueError("limit must be between 1 and 50")
    url = str(ctx.get("site_selection_url") or os.environ.get(
        "TB_SITE_SELECTION_URL", "http://127.0.0.1:3080/api/site-selection"
    ))
    token = str(ctx.get("site_selection_token") or os.environ.get("TB_SITE_SELECTION_TOKEN", "")).strip()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        url, data=json.dumps({"consultationId": consultation_id, "limit": limit}).encode(),
        headers=headers, method="POST",
    )
    with urlopen(request, timeout=30) as response:
        result = json.loads(response.read().decode())
    if result.get("status") != "proposed" or result.get("humanApprovalRequired") is not True:
        raise ValueError("selection service returned an unsafe decision contract")
    return result

TOOL_HANDLERS = {
    "search_proprietary": _h_search_proprietary,
    "query_datasus": _h_query_datasus,
    "build_pack": _h_build_pack,
    "site_shortlist": _h_site_shortlist,
}

# ---- Robust JSON extraction from an agent's free-text reply ----

def _extract_json(text: str | None) -> dict:
    """Best-effort: pull one JSON object out of an agent reply that may be raw JSON,
    fenced in ```json ... ```, or wrapped in prose. When prose contains a decoy object
    before the real one, prefer the LARGEST parseable object. Returns {} if none parses."""
    if not text:
        return {}
    t = text.strip()
    # 1) fenced block wins if present
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(1).strip())
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    # 2) whole string is a JSON object
    try:
        obj = json.loads(t)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    # 3) fallback: parse every balanced {...} candidate, return the largest dict
    dec = json.JSONDecoder()
    best = None
    for i, ch in enumerate(t):
        if ch != "{":
            continue
        try:
            obj, _ = dec.raw_decode(t[i:])
        except Exception:
            continue
        if isinstance(obj, dict) and (best is None or len(obj) > len(best)):
            best = obj
    return best if best is not None else {}

# ---- CMA session driver (Pattern A). Stream-first; execute custom tools host-side. ----

def run_agent(client, agent_id: str, env_id: str, kickoff: dict, ctx: dict) -> dict:
    """Drive one agent session to a terminal idle. Returns
    {"json": <parsed last agent.message text>, "tool_results": {tool_name: last host result}}.
    For data stages the caller should prefer tool_results (the host computed them) over json."""
    session = client.beta.sessions.create(agent=agent_id, environment_id=env_id)
    final_text = None
    tool_results: dict = {}
    with client.beta.sessions.events.stream(session_id=session.id) as stream:
        client.beta.sessions.events.send(session_id=session.id, events=[kickoff])
        for event in stream:
            et = getattr(event, "type", None)
            if et == "agent.message":
                for block in event.content:
                    if getattr(block, "type", None) == "text":
                        final_text = block.text
            elif et == "agent.custom_tool_use":
                name = event.name
                try:
                    result = TOOL_HANDLERS[name](event.input, ctx)
                    tool_results[name] = result
                    payload = {"type": "user.custom_tool_result", "custom_tool_use_id": event.id,
                               "content": [{"type": "text", "text": json.dumps(result)}]}
                except Exception as e:  # Spec §7: surface as is_error, never silent drop
                    payload = {"type": "user.custom_tool_result", "custom_tool_use_id": event.id,
                               "is_error": True,
                               "content": [{"type": "text", "text": f"handler error: {e}"}]}
                client.beta.sessions.events.send(session_id=session.id, events=[payload])
            elif et == "session.status_terminated":
                break
            elif et == "session.status_idle":
                if getattr(getattr(event, "stop_reason", None), "type", None) != "requires_action":
                    break
    return {"json": _extract_json(final_text), "tool_results": tool_results}

def _msg(text: str) -> dict:
    return {"type": "user.message", "content": [{"type": "text", "text": text}]}

def run_site_selection(consultation_id: str, *, limit: int = 20, client=None,
                       site_selection_url: str | None = None) -> dict:
    """Run the dedicated selection agent after the reviewed estimate is available."""
    import anthropic
    if not consultation_id.strip():
        raise ValueError("consultation_id required")
    if limit < 1 or limit > 50:
        raise ValueError("limit must be between 1 and 50")
    client = client or anthropic.Anthropic()
    ids = load_site_selection_agent_ids()
    payload = {"consultation_id": consultation_id, "limit": limit}
    output = run_agent(
        client, ids["site_selection"], ids["environment"],
        _msg("Call site_shortlist with this locked request and return the tool result.\n" + json.dumps(payload)),
        ctx={"expected_consultation_id": consultation_id,
             "site_selection_url": site_selection_url},
    )
    result = output["tool_results"].get("site_shortlist") or output["json"]
    if not isinstance(result, dict) or result.get("status") != "proposed" or result.get("humanApprovalRequired") is not True:
        raise RuntimeError("site selection agent produced no safe proposed result")
    return result

def run_pipeline(nct_or_text: str, *, client=None, parquet_glob=None, datasus_dir=None,
                 proprietary_backend: str | None = None,
                 elasticsearch_url: str | None = None,
                 elasticsearch_index: str | None = None,
                 fetch_trial=None, nct: str | None = None,
                 verified_criteria: list[dict] | None = None,
                 proprietary_capture: str | None = None,
                 proprietary_inventory: str | None = None,
                 datasus_capture: str | None = None,
                 progress: Callable[[str], None] | None = None) -> FeasibilityPack:
    """Run intake -> proprietary -> datasus_enrich. `nct_or_text` is protocol/eligibility text
    (recommended) or an NCT id; if `fetch_trial` is given and the input looks like an NCT id,
    it is called host-side to resolve the eligibility text so the intake agent needs no MCP."""
    import anthropic
    client = client or anthropic.Anthropic()
    proprietary_backend = (proprietary_backend or
                           os.environ.get("TB_PROPRIETARY_SEARCH_BACKEND", "duckdb")).lower()
    if proprietary_backend == "elasticsearch":
        elasticsearch_url = elasticsearch_url or os.environ["TB_ELASTICSEARCH_URL"]
        elasticsearch_index = elasticsearch_index or os.environ["TB_ELASTICSEARCH_INDEX"]
    elif proprietary_backend == "duckdb":
        parquet_glob = (parquet_glob or os.environ.get("TB_FULL_PROPRIETARY_GLOB") or
                        os.environ["TB_PROPRIETARY_GLOB"])
    else:
        raise ValueError(f"unsupported proprietary backend: {proprietary_backend!r}")
    datasus_dir = datasus_dir or os.environ["TB_DATASUS_DIR"]
    ids = load_agent_ids()
    env = ids["environment"]

    def report(stage: str) -> None:
        if progress:
            progress(stage)

    trial_text = nct_or_text
    if fetch_trial and nct_or_text.strip().upper().startswith("NCT"):
        trial_text = fetch_trial(nct_or_text.strip())

    report("intake_running")
    intake_payload = {
        "nct": nct or (nct_or_text.strip().upper() if nct_or_text.strip().upper().startswith("NCT") else "UNKNOWN"),
        "protocol_text": trial_text,
        "verified_criteria": verified_criteria or [],
        "instructions": (
            "Treat verified_criteria as the source of truth. Use protocol_text only for context "
            "or criteria not represented there. Never restore a criterion removed during human review."
        ),
    }
    intake = run_agent(client, ids["intake"], env,
                       _msg("Build a SearchSpec from this sponsor-verified intake envelope. "
                            "Return ONLY raw JSON.\n\n" + json.dumps(intake_payload)), ctx={})
    spec = intake["json"]
    if not spec:
        raise RuntimeError("intake agent produced no parseable SearchSpec (empty JSON) — "
                           "check the intake agent output / prompt")
    parsed_spec = SearchSpec.model_validate(spec)
    locked_nct = str(intake_payload["nct"]).upper()
    if locked_nct != "UNKNOWN" and parsed_spec.nct.upper() != locked_nct:
        raise RuntimeError(
            f"intake agent changed locked NCT {locked_nct} to {parsed_spec.nct}; refusing data lookup"
        )
    if locked_nct == "UNKNOWN":
        locked_nct = parsed_spec.nct.upper()
    spec = parsed_spec.model_dump()

    report("proprietary_running")
    prop_out = run_agent(client, ids["proprietary"], env,
                         _msg("Call search_proprietary with this spec, then return its result.\n"
                              + json.dumps({"spec": spec})),
                         ctx={"proprietary_backend": proprietary_backend,
                              "parquet_glob": parquet_glob,
                              "elasticsearch_url": elasticsearch_url,
                              "elasticsearch_index": elasticsearch_index,
                              "proprietary_capture": proprietary_capture,
                              "proprietary_inventory": proprietary_inventory,
                              "expected_nct": locked_nct})
    prop = prop_out["tool_results"].get("search_proprietary") or prop_out["json"]

    report("datasus_running")
    pack_out = run_agent(client, ids["datasus_enrich"], env,
                         _msg("Call query_datasus then build_pack; return the FeasibilityPack.\n"
                              + json.dumps({"spec": spec, "proprietary": prop})),
                         ctx={"datasus_dir": datasus_dir,
                              "datasus_capture": datasus_capture,
                              "expected_nct": locked_nct})
    pack = pack_out["tool_results"].get("build_pack") or pack_out["json"]
    result = FeasibilityPack.model_validate(pack)
    report("complete")
    return result
