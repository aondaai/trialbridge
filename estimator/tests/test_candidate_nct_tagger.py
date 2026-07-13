import importlib.util
from pathlib import Path
import sys

import pytest


SCRIPT = Path(__file__).parents[2] / "scripts" / "elasticsearch" / "tag_candidate_ncts.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("tag_candidate_ncts", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def test_nct_is_derived_from_export_path():
    assert MODULE.nct_from_path(Path("notes_NCT06982521/export.jsonl")) == "NCT06982521"


def test_ambiguous_or_missing_nct_is_rejected():
    with pytest.raises(ValueError, match="exactly one NCT"):
        MODULE.nct_from_path(Path("export.jsonl"))
    with pytest.raises(ValueError, match="exactly one NCT"):
        MODULE.nct_from_path(Path("NCT06982521/NCT07687459.jsonl"))
