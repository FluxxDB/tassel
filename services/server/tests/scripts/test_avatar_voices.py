"""Catalog export uses metadata GETs only, with mocked provider responses."""

import io
import json
from types import SimpleNamespace
from urllib.error import HTTPError

import pytest

from tassel.scripts import export_avatar_voices as exporter


def test_metadata_export_drops_private_fields_and_never_fetches_audio(monkeypatch):
    monkeypatch.setattr(
        exporter.VoiceSettings,
        "load",
        lambda: SimpleNamespace(
            elevenlabs_api_key=SimpleNamespace(get_secret_value=lambda: "fake-test-key")
        ),
    )
    urls = []

    def get(request, timeout):
        urls.append(request.full_url)
        if "/v2/voices" in request.full_url:
            return io.StringIO('{"voices": []}')
        return io.StringIO(
            json.dumps(
                {
                    "voices": [
                        {
                            "voice_id": "public-example",
                            "name": "Example",
                            "accent": "american",
                            "preview_url": "https://example.com/preview.mp3",
                            "private_owner_email": "never-export@example.com",
                        }
                    ]
                }
            )
        )

    monkeypatch.setattr(exporter, "urlopen", get)
    catalog = exporter.export()
    assert catalog["synthesisEnabled"] is False
    assert all("/v1/shared-voices?" in url or "/v2/voices?" in url for url in urls)
    output = json.dumps(catalog)
    assert "fake-test-key" not in output
    assert "never-export" not in output
    assert all(v["accountAvailability"] == "library-only" for v in catalog["voices"])
    assert all(v["listeningVerified"] is False for v in catalog["voices"])


def test_provider_errors_do_not_echo_responses_or_credentials(monkeypatch):
    monkeypatch.setattr(
        exporter.VoiceSettings,
        "load",
        lambda: SimpleNamespace(
            elevenlabs_api_key=SimpleNamespace(get_secret_value=lambda: "fake-test-key")
        ),
    )

    def unavailable(request, timeout):
        raise HTTPError(request.full_url, 401, "private provider detail", {}, None)

    monkeypatch.setattr(exporter, "urlopen", unavailable)
    with pytest.raises(RuntimeError, match=r"^Voice metadata lookup failed \(401\)\.$"):
        exporter.export()
