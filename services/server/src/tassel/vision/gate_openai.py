"""OpenAI Decisions predicates; one bounded attempt, with explicit refusals."""

import asyncio
import base64
import time

import openai
from pydantic import SecretStr

from tassel.vision.gate import _probability, gate_text
from tassel.vision.ports import (
    PREDICATE_QUESTIONS,
    PREDICATES,
    GateError,
    GateInput,
    GateResult,
    Predicate,
)


def openai_request(gi: GateInput, *, model: str) -> dict:
    content = [{"type": "input_text", "text": gate_text(gi)}]
    if gi.image_jpeg is not None:
        encoded = base64.b64encode(gi.image_jpeg).decode("ascii")
        content.append(
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{encoded}",
                "detail": "auto",
            }
        )
    return {
        "model": model,
        "input": [{"role": "user", "content": content}],
        "questions": [
            {"type": "predicate", "name": p, "instructions": PREDICATE_QUESTIONS[p]}
            for p in PREDICATES
        ],
    }


def parse_openai_decision(body: dict) -> tuple[dict[Predicate, float], tuple[Predicate, ...]]:
    """Require a complete ordered answer set; a refusal is never a probability."""
    probs: dict[Predicate, float] = {}
    refused: list[Predicate] = []
    try:
        answers = body["answers"]
        if not isinstance(answers, list) or len(answers) != len(PREDICATES):
            raise ValueError
        for p, answer in zip(PREDICATES, answers, strict=True):
            if answer["name"] != p:
                raise ValueError
            if answer["type"] == "refusal":
                refused.append(p)
            elif answer["type"] == "predicate":
                probs[p] = _probability(answer["probability"])
            else:
                raise ValueError
    except (KeyError, TypeError, ValueError):
        raise GateError("OpenAI Decisions returned invalid answers") from None
    return probs, tuple(refused)


class OpenAIDecisionsGate:
    name = "openai"

    def __init__(
        self,
        *,
        api_key: SecretStr,
        model: str = "gpt-6-luna",
        timeout_s: float = 4.0,
        client: openai.AsyncOpenAI | None = None,
    ):
        self._model = model
        self._timeout_s = timeout_s
        self._owns_client = client is None
        self._client = (
            client
            if client is not None
            else openai.AsyncOpenAI(
                api_key=api_key.get_secret_value(),
                timeout=timeout_s,
                max_retries=0,
            )
        )

    async def evaluate(self, gi: GateInput) -> GateResult:
        started = time.perf_counter()
        try:
            async with asyncio.timeout(self._timeout_s):
                # Also disable retries on injected clients; the gate must remain advisory.
                response = await self._client.with_options(
                    timeout=self._timeout_s,
                    max_retries=0,
                ).decisions.with_raw_response.create(**openai_request(gi, model=self._model))
                # Validate wire values before SDK coercion or serialization warnings.
                probs, refused = parse_openai_decision(response.http_response.json())
        except GateError:
            raise
        except openai.APIStatusError as exc:
            raise GateError(f"OpenAI Decisions HTTP {exc.status_code}") from None
        except Exception:
            # SDK/transport exceptions may contain headers, frames or transcript text.
            raise GateError("OpenAI Decisions request failed") from None
        return GateResult(
            probs=probs,
            refused=refused,
            ms=int((time.perf_counter() - started) * 1000),
            provider=self.name,
        )

    async def aclose(self) -> None:
        """Release our connection pool; injected clients remain caller-owned."""
        if self._owns_client:
            await self._client.close()
