"""Read-only voice metadata export. No synthesis, audio downloads or account mutations."""

import json
import sys
from datetime import UTC, datetime
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from tassel.voice.settings import VoiceSettings

TARGETS = [
    ("en", "american"),
    ("en", "british"),
    ("en", "indian"),
    ("en", "australian"),
    ("es", "mexican"),
    ("es", "castilian"),
    ("ko", None),
]


def export() -> dict:
    settings = VoiceSettings.load()
    if not settings.elevenlabs_api_key:
        raise RuntimeError(
            "ELEVENLABS_API_KEY is required for metadata access; no speech is generated."
        )

    def get(path: str, params: list[tuple[str, str]]) -> dict:
        request = Request(
            "https://api.elevenlabs.io" + path + "?" + urlencode(params),
            headers={"xi-api-key": settings.elevenlabs_api_key.get_secret_value()},
        )
        try:
            with urlopen(request, timeout=20) as response:
                return json.load(response)
        except HTTPError as error:
            raise RuntimeError(f"Voice metadata lookup failed ({error.code}).") from None

    voices = []
    missing = []
    for language, accent in TARGETS:
        params = [("page_size", "3"), ("gender", "female"), ("language", language)]
        if accent:
            params.append(("accent", accent))
        candidates = get("/v1/shared-voices", params).get("voices", [])
        if not candidates:
            missing.append({"language": language, "accent": accent})
        for voice in candidates:
            voice_id, name = voice.get("voice_id"), voice.get("name")
            if not isinstance(voice_id, str) or not isinstance(name, str):
                continue
            if any(v["id"] == voice_id and v["language"] == language for v in voices):
                continue
            verified = next(
                (v for v in voice.get("verified_languages", []) if v.get("language") == language),
                {},
            )
            preview = verified.get("preview_url") or voice.get("preview_url")
            voices.append(
                {
                    "id": voice_id,
                    "name": name[:120],
                    "language": language,
                    "accent": verified.get("accent")
                    or voice.get("accent")
                    or accent
                    or "unspecified",
                    "previewUrl": preview
                    if isinstance(preview, str) and preview.startswith("https://")
                    else None,
                    "source": "elevenlabs-public-library",
                    "accountAvailability": "not-verified",
                    "listeningVerified": False,
                }
            )
    if not voices:
        raise RuntimeError("No voices found; existing catalog preserved.")
    available = get("/v2/voices", [("page_size", "100")] + [("voice_ids", v["id"]) for v in voices])
    available_ids = {v.get("voice_id") for v in available.get("voices", [])}
    for voice in voices:
        voice["accountAvailability"] = (
            "available" if voice["id"] in available_ids else "library-only"
        )
    return {
        "version": 1,
        "fetchedAt": datetime.now(UTC).isoformat(),
        "synthesisEnabled": False,
        "sourceUrl": "https://api.elevenlabs.io/v1/shared-voices",
        "missing": missing,
        "voices": voices,
    }


if __name__ == "__main__":
    if sys.argv[1:] != ["--metadata-only"]:
        sys.exit("Only --metadata-only is supported.")
    try:
        print(json.dumps(export(), ensure_ascii=False))
    except Exception as error:
        # Do not print provider responses, request headers, settings or credentials.
        if isinstance(error, RuntimeError):
            sys.exit(str(error))
        sys.exit("Voice metadata export failed; existing catalog preserved.")
