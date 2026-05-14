"""Pytest fixtures: every test gets its own SQLite file under tmp_path (never touches JOBTRACKER_DB)."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

import pytest
import sqlite3

from applyledger import db


@pytest.fixture
def isolated_db_path(tmp_path: Path) -> str:
    path = str(tmp_path / "unit_test.sqlite3")
    db.init_db(path)
    return path


@pytest.fixture
def conn(isolated_db_path: str) -> Generator[sqlite3.Connection, None, None]:
    c = db.connect(isolated_db_path)
    c.row_factory = sqlite3.Row
    try:
        yield c
    finally:
        c.close()
