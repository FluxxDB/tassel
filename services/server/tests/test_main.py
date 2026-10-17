import uvicorn
from fastapi import FastAPI

from tassel.__main__ import main, uvicorn_loop


def test_main_serves_the_app_on_host_and_port_from_env(monkeypatch):
    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: calls.append((app, kwargs)))
    monkeypatch.setenv("TASSEL_HOST", "127.0.0.2")
    monkeypatch.setenv("TASSEL_PORT", "8799")

    main()

    [(app, kwargs)] = calls
    assert isinstance(app, FastAPI)
    assert kwargs == {"host": "127.0.0.2", "port": 8799, "loop": uvicorn_loop()}


def test_windows_uses_a_selector_event_loop_for_psycopg():
    assert uvicorn_loop("win32") == "asyncio:SelectorEventLoop"
    assert uvicorn_loop("darwin") == "auto"
    assert uvicorn_loop("linux") == "auto"
