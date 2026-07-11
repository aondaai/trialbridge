"""Hospital->UF lookup: confirmed codes resolve, unconfirmed return None (never guessed)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trialbridge.geo import known_ufs, uf_for


def test_user_confirmed_mappings():
    assert uf_for("ha") == "SP"    # Hospital de Amor / Barretos
    assert uf_for("hac") == "PR"   # Angelina Caron
    assert uf_for("hmd") == "RS"   # Mae de Deus


def test_high_confidence_mappings():
    assert uf_for("uopeccan") == "PR"
    assert uf_for("imip") == "PE"
    assert uf_for("hmv") == "RS"
    assert uf_for("unimedfor") == "CE"


def test_unconfirmed_returns_none_not_a_guess():
    assert uf_for("hsl") is None          # explicitly unconfirmed
    assert uf_for("does-not-exist") is None


def test_known_ufs_excludes_none():
    ufs = known_ufs()
    assert None not in ufs
    assert {"SP", "PR", "RS", "MG", "CE", "PE"} <= ufs
