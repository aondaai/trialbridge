import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.data import BaseRecord, MaterializedProprietary
from trialbridge.finding import finding_n_by_site
from trialbridge.schema import Criterion, Protocol


def _write_base(d, records, prov=None):
    with open(os.path.join(d, "records.json"), "w") as f:
        json.dump(records, f)
    with open(os.path.join(d, "provenance.json"), "w") as f:
        json.dump(prov or {"source": "test", "as_of": "2026-07-11"}, f)


def test_reads_records_as_baserecords_and_finding_works():
    records = [
        {"site": "ha", "region": "ha", "dx": "breast_cancer", "age_band": "50-59", "sex": "F", "count": 100},
        {"site": "ha", "region": "ha", "dx": "breast_cancer", "age_band": "70+", "sex": "F", "count": 20},
        {"site": "hb", "region": "hb", "dx": "lung_cancer", "age_band": "50-59", "sex": "F", "count": 40},
    ]
    with tempfile.TemporaryDirectory() as d:
        _write_base(d, records)
        src = MaterializedProprietary(base_dir=d)
        assert all(isinstance(r, BaseRecord) for r in src.records())
        assert src.provenance.get("source") == "test"
        protocol = Protocol("t", [
            Criterion("dx", "breast", "inclusion", "checkable", "dx", "in", ["breast_cancer"]),
            Criterion("sex", "F", "inclusion", "checkable", "sex", "eq", "F"),
            Criterion("age", "18-69", "inclusion", "checkable", "age_band", "in",
                      ["18-39", "40-49", "50-59", "60-69"]),
        ])
        out = {s.site: s for s in finding_n_by_site(protocol, src)}
        assert out["ha"].finding_n == 100   # 70+ excluded by age; lung (hb) excluded by dx
        assert out["ha"].with_dx == 120     # both breast strata at ha
        assert "hb" not in out or out["hb"].finding_n == 0
