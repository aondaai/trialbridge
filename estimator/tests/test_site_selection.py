import json

import pytest

from pipeline import orchestrator


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


def test_site_shortlist_handler_locks_consultation_and_requires_human_gate(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode())
        captured["timeout"] = timeout
        return _Response({
            "schemaVersion": "site-selection-tool.v1",
            "consultationId": "consult-1",
            "status": "proposed",
            "humanApprovalRequired": True,
            "shortlist": {"entries": []},
        })

    monkeypatch.setattr(orchestrator, "urlopen", fake_urlopen)
    result = orchestrator._h_site_shortlist(
        {"consultation_id": "consult-1", "limit": 10},
        {"expected_consultation_id": "consult-1", "site_selection_url": "http://selection.test"},
    )
    assert captured["body"] == {"consultationId": "consult-1", "limit": 10}
    assert result["status"] == "proposed"
    assert result["humanApprovalRequired"] is True


def test_site_shortlist_handler_rejects_agent_id_swap_and_unsafe_response(monkeypatch):
    with pytest.raises(ValueError, match="locked"):
        orchestrator._h_site_shortlist(
            {"consultation_id": "other"},
            {"expected_consultation_id": "consult-1"},
        )

    monkeypatch.setattr(orchestrator, "urlopen", lambda *_args, **_kwargs: _Response({
        "status": "approved", "humanApprovalRequired": False,
    }))
    with pytest.raises(ValueError, match="unsafe decision contract"):
        orchestrator._h_site_shortlist(
            {"consultation_id": "consult-1"},
            {"expected_consultation_id": "consult-1", "site_selection_url": "http://selection.test"},
        )


def test_site_shortlist_is_registered_as_a_host_tool():
    assert orchestrator.TOOL_HANDLERS["site_shortlist"] is orchestrator._h_site_shortlist
