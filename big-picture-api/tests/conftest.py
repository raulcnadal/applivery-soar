"""Shared pytest fixtures for the backend test suite.

main.py has real import-time side effects: it creates a `data/` directory
(and many subdirectories under it) relative to the current working
directory, and hard-requires the DASHBOARD_SECRET environment variable to be
set (see main.py's startup check) or import itself raises. Both are handled
here, once, before main.py is ever imported by any test module — so no
individual test file needs to think about it, and none of this touches the
real repo's `data/` folder or an actual deployment's secrets.

This suite deliberately targets main.py's PURE, side-effect-free functions
(condition evaluation, risk scoring, destructive-step detection, circuit
breaker trip logic) rather than spinning up the full FastAPI app against a
mocked Applivery API — that's a much bigger undertaking (auth, per-workspace
JSON stores, live HTTP mocking) and the safety-critical logic that most
needs regression coverage lives in plain functions that don't need any of
that scaffolding to test thoroughly.
"""
import os
import sys
import tempfile

import pytest

API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="session", autouse=True)
def _isolated_cwd_and_env():
    original_cwd = os.getcwd()
    tmp_dir = tempfile.mkdtemp(prefix="soar_backend_tests_")
    os.chdir(tmp_dir)
    os.environ.setdefault("DASHBOARD_SECRET", "test-secret-not-for-production")
    try:
        yield
    finally:
        os.chdir(original_cwd)


@pytest.fixture(scope="session")
def main(_isolated_cwd_and_env):
    """The main module, imported exactly once per test session, after the
    cwd/env fixture above has already taken effect."""
    sys.path.insert(0, API_DIR)
    import main as main_module
    return main_module
