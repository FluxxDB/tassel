"""Every test runs without vision keys and without the network (P4 Task 1, the plan review's C1).

The root conftest's autouse fixtures do this: ``scrub_vision_env`` deletes the provider keys and
vision settings and points ``TASSEL_VOICE_ENV_FILE`` at nothing, and ``no_provider_network`` makes
the real ``httpx`` and ``httpx2`` transports refuse every host but loopback. These tests sit at the
root, beside the fixtures they check, so they cover every suite: P1's, P2's, P3's and P4's.
"""

import os
import socket
import subprocess
import sys
import threading
from collections.abc import Iterator
from fnmatch import fnmatchcase
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import httpx2
import pytest

from tassel.vision.settings import VisionSettings, resolve_vision_mode

SERVER_DIR = Path(__file__).resolve().parents[1]

# What a shell may hold: P4's three keys, and the SDKs' other variables (base URLs, auth tokens).
_PROVIDER_VARIABLES = ("OPENAI_*", "ANTHROPIC_*", "VULTR_*")


def _provider_variables() -> list[str]:
    # Upper-cased, because pydantic-settings matches variable names in any case.
    return [
        name
        for name in os.environ
        if any(fnmatchcase(name.upper(), pattern) for pattern in _PROVIDER_VARIABLES)
    ]


def _attempt_a_provider_request() -> str:
    """What a real request to OpenAI meets, with name lookups refused so nothing leaves."""

    def refuse(*args, **kwargs):
        raise AssertionError("reached for the network")

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(socket, "getaddrinfo", refuse)
        patch.setattr(socket, "create_connection", refuse)
        try:
            with httpx2.Client() as client:
                client.get("https://api.openai.com/v1/models")
        except RuntimeError as refused:
            return str(refused)
        except AssertionError:
            return "unguarded"
    return "sent"


def _what_is_seen() -> dict[str, object]:
    return {
        "variables": _provider_variables(),
        "env_file": os.environ.get("TASSEL_VOICE_ENV_FILE"),
        "network": _attempt_a_provider_request(),
    }


ISOLATED = {
    "variables": [],
    "env_file": "",
    "network": "tests never reach the network: api.openai.com",
}

# Collection imports this module before any fixture runs.
SEEN_AT_IMPORT = _what_is_seen()


def test_tests_never_see_vision_keys():
    assert _provider_variables() == []
    assert os.environ["TASSEL_VOICE_ENV_FILE"] == ""
    s = VisionSettings.load()
    assert resolve_vision_mode("gate", s) == "fake"
    assert resolve_vision_mode("deepcheck", s) == "fake"
    assert (s.openai_api_key, s.anthropic_api_key, s.vultr_inference_api_key) == (None, None, None)


@pytest.fixture(scope="session")
def seen_by_a_session_fixture() -> dict[str, object]:
    # Set up before every function-scoped fixture, the autouse ones included.
    return _what_is_seen()


def test_session_fixtures_and_imports_are_isolated_too(seen_by_a_session_fixture):
    # Beyond the brief: the session-wide scrub and guard (pytest_configure) cover what runs
    # before the function-scoped fixtures do.
    assert seen_by_a_session_fixture == ISOLATED
    assert SEEN_AT_IMPORT == ISOLATED


@pytest.fixture
def sockets(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Records, and refuses, every name lookup and connection the test attempts."""
    attempts: list[str] = []

    def refuse(name: str):
        def refused(*args, **kwargs):
            attempts.append(name)
            raise AssertionError(f"the test reached for the network through {name}")

        return refused

    monkeypatch.setattr(socket, "getaddrinfo", refuse("getaddrinfo"))
    monkeypatch.setattr(socket, "create_connection", refuse("create_connection"))
    monkeypatch.setattr(socket.socket, "connect", refuse("socket.connect"))
    monkeypatch.setattr(socket.socket, "connect_ex", refuse("socket.connect_ex"))
    return attempts


@pytest.mark.asyncio
async def test_network_is_refused_in_tests(sockets: list[str]):
    for module in (httpx2, httpx):
        with pytest.raises(
            RuntimeError, match=r"^tests never reach the network: api\.openai\.com$"
        ):
            async with module.AsyncClient() as client:
                await client.get("https://api.openai.com/v1/models")
        with pytest.raises(
            RuntimeError, match=r"^tests never reach the network: api\.anthropic\.com$"
        ):
            with module.Client() as client:
                client.get("https://api.anthropic.com/v1/messages")
    assert sockets == []

    mocked = httpx2.MockTransport(lambda request: httpx2.Response(200, json={"data": []}))
    with httpx2.Client(transport=mocked) as client:
        assert client.get("https://api.openai.com/v1/models").json() == {"data": []}
    assert sockets == []


# Beyond the brief's examples.


def test_a_shell_full_of_keys_still_runs_fake(tmp_path: Path):
    # A developer's shell often exports ANTHROPIC_API_KEY, and pydantic-settings reads names in
    # any case, so the check above runs again in a pytest whose environment holds dummy keys in
    # both cases, live modes, and a voice .env file with keys in it.
    env_file = tmp_path / "keys.env"
    env_file.write_text(
        "OPENAI_API_KEY=sk-dummy-file\nANTHROPIC_API_KEY=ak-dummy-file\nTASSEL_PROVIDERS=live\n",
        encoding="utf-8",
    )
    env = {
        **os.environ,
        "OPENAI_API_KEY": "sk-dummy-shell",
        "anthropic_api_key": "ak-dummy-shell",
        "ANTHROPIC_BASE_URL": "http://127.0.0.1:9",
        "VULTR_INFERENCE_API_KEY": "vu-dummy-shell",
        "TASSEL_PROVIDERS": "live",
        "TASSEL_GATE_PROVIDER": "live",
        "TASSEL_GATE_LIVE": "clef",
        "TASSEL_DEEPCHECK_PROVIDER": "live",
        "TASSEL_FAKE_READING": "demo-wrong",
        "TASSEL_VOICE_ENV_FILE": str(env_file),
    }
    probe = f"{Path(__file__).name}::test_tests_never_see_vision_keys"
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", f"tests/{probe}"],
        cwd=SERVER_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout[-2000:] + result.stderr[-2000:]
    assert "1 passed" in result.stdout


@pytest.fixture
def local_server() -> Iterator[int]:
    """A real HTTP server on 127.0.0.1, as P2's and P3's local servers are, on a free port."""

    class Hello(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"hello"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Hello)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.asyncio
async def test_loopback_still_works(local_server: int):
    url = f"http://127.0.0.1:{local_server}/"
    for module in (httpx2, httpx):
        with module.Client() as client:
            assert client.get(url).text == "hello"
        async with module.AsyncClient() as client:
            assert (await client.get(url)).text == "hello"


@pytest.mark.asyncio
async def test_a_proxy_never_carries_a_request_out(monkeypatch: pytest.MonkeyPatch):
    # With HTTPS_PROXY set, the client mounts a proxy transport: still an HTTPTransport, and the
    # request's host is still the provider's, so it is refused before any proxy is reached.
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:9")
    for module in (httpx2, httpx):
        with pytest.raises(RuntimeError, match=r"api\.openai\.com"):
            with module.Client() as client:
                client.get("https://api.openai.com/v1/models")
        with pytest.raises(RuntimeError, match=r"api\.anthropic\.com"):
            async with module.AsyncClient() as client:
                await client.get("https://api.anthropic.com/v1/messages")
