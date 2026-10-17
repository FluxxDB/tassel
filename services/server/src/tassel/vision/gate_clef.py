"""Vultr System One's Clef gate, with single-use image references."""

import asyncio
import base64
import re
import time
from uuid import uuid4

import httpx2
from pydantic import SecretStr

from tassel.vision.gate import _probability, gate_text
from tassel.vision.ports import PREDICATE_QUESTIONS, PREDICATES, GateError, GateInput, GateResult

VULTR_SYSTEMONE_URL = "https://api.vultrinference.com/v1/systemone"


def clef_request(gi: GateInput, *, model: str, ref: str) -> dict:
    body = {
        "model": model,
        "state": {"context": gate_text(gi)},
        "questions": {
            p: {"type": "noul", "instructions": PREDICATE_QUESTIONS[p]} for p in PREDICATES
        },
    }
    if gi.image_jpeg is not None:
        body["state"]["page"] = ref
        body["assets"] = {
            ref: {
                "type": "image",
                "format": "jpeg",
                "data_base64": base64.b64encode(gi.image_jpeg).decode("ascii"),
            }
        }
    return body


class ClefGate:
    name = "clef"

    def __init__(
        self,
        *,
        api_key: SecretStr,
        model: str = "clef-flash",
        timeout_s: float = 4.0,
        client: httpx2.AsyncClient | None = None,
    ):
        self._api_key = api_key
        self._model = model
        self._timeout_s = timeout_s
        self._owns_client = client is None
        self._client = client if client is not None else httpx2.AsyncClient(timeout=timeout_s)

    def _status_error(self, response: httpx2.Response) -> GateError:
        error_type = "unknown"
        try:
            candidate = response.json()["metadata"]["error_type"]
            # Only the machine-readable type is diagnostic; never echo a provider message.
            if (
                isinstance(candidate, str)
                and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,63}", candidate)
                and self._api_key.get_secret_value() not in candidate
            ):
                error_type = candidate
        except (ValueError, KeyError, TypeError):
            pass
        return GateError(f"Clef HTTP {response.status_code}: {error_type}")

    async def evaluate(self, gi: GateInput) -> GateResult:
        started = time.perf_counter()
        headers = {
            "Authorization": f"Bearer {self._api_key.get_secret_value()}",
            "Content-Type": "application/json",
        }
        if gi.image_jpeg is not None:
            headers["TypeSafe-Danger-Zone-Images"] = "true"
        try:
            async with asyncio.timeout(self._timeout_s):
                response = await self._client.post(
                    VULTR_SYSTEMONE_URL,
                    headers=headers,
                    json=clef_request(gi, model=self._model, ref=str(uuid4())),
                    timeout=self._timeout_s,
                )
                if response.status_code != 200:
                    raise self._status_error(response)
                answers = response.json()["answers"]
                if not isinstance(answers, dict) or set(answers) != set(PREDICATES):
                    raise ValueError
                probs = {}
                for p in PREDICATES:
                    if answers[p]["type"] != "noul":
                        raise ValueError
                    probs[p] = _probability(answers[p]["noul"])
        except GateError:
            raise
        except Exception:
            raise GateError("Clef request failed or returned invalid answers") from None
        return GateResult(
            probs=probs,
            refused=(),
            ms=int((time.perf_counter() - started) * 1000),
            provider=self.name,
        )

    async def aclose(self) -> None:
        """Release our connection pool; injected clients remain caller-owned."""
        if self._owns_client:
            await self._client.aclose()
