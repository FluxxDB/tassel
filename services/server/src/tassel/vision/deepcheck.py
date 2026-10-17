"""Shared deep-check interface, preparation and offline-testable provider adapters.

Nothing loads settings or constructs a client at import time. Provider bodies and error strings
are never logged: only the operation, status and sanitized request id cross that boundary.
"""

import base64
import json
import logging
import re
from collections.abc import Sequence
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass, field, replace
from time import perf_counter
from typing import Literal, Protocol

import anthropic
import openai
from anyio import CapacityLimiter
from pydantic import SecretStr, ValidationError

from tassel.domains.dfa.contract import PREDICATE_SCHEMA, DfaReading, MembershipPredicate, Pt
from tassel.models import Lang
from tassel.vision.marks import Candidates, draw_marks, find_candidates
from tassel.vision.page import FlatPage, encode_jpeg, flatten_page
from tassel.vision.ports import TranscriptLine
from tassel.vision.prompts import MEMBERSHIP_SYSTEM, TRANSCRIBE_SYSTEM, render_context
from tassel.vision.settings import VisionSettings, resolve_deepcheck_provider
from tassel.vision.transcription import TRANSCRIPTION_SCHEMA, DfaTranscription

OPENAI_DEEPCHECK_MODEL = (
    "gpt-6-sol"  # Documented vision + structured outputs; live eval remains owed.
)
TRANSCRIPTION_MAX_TOKENS = 16000  # Includes reasoning/output tokens on both providers.
MEMBERSHIP_MAX_TOKENS = 4000  # Independent text-only membership call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"  # Anthropic's specified fallback contract.
_REFUSAL_CATEGORIES = frozenset(
    {"cyber", "bio", "frontier_llm", "reasoning_extraction", "general_harms"}
)
_LOG = logging.getLogger(__name__)
Status = Literal["ok", "refused", "failed", "timeout"]
# Local readers inherit the orchestrator's shared worker budget without changing the network
# port. Context-local storage also supports one injected reader shared by multiple sessions.
CPU_LIMITER: ContextVar[CapacityLimiter | None] = ContextVar("vision_cpu_limiter", default=None)


@dataclass(frozen=True)
class ProblemContext:
    title: str | None
    early_lines: tuple[str, ...]
    recent: tuple[TranscriptLine, ...]
    lang: Lang


@dataclass(frozen=True)
class PreparedPage:
    page: FlatPage
    candidates: Candidates
    marked_jpeg: bytes = field(repr=False)
    crop_jpeg: bytes | None = field(repr=False)


def prepare(full_jpeg: bytes, quad: Sequence[Pt] | None, crop_jpeg: bytes | None) -> PreparedPage:
    """Pure CPU preparation; the orchestrator calls this in its shared worker limiter."""
    page = flatten_page(full_jpeg, quad)
    candidates = find_candidates(page)
    return PreparedPage(page, candidates, encode_jpeg(draw_marks(page, candidates)), crop_jpeg)


@dataclass(frozen=True)
class TranscriptionResult:
    status: Status
    transcription: DfaTranscription | None
    ms: int
    detail: str | None = None
    reading: DfaReading | None = None


class DeepCheck(Protocol):
    name: str

    async def transcribe(
        self, prepared: PreparedPage, ctx: ProblemContext
    ) -> TranscriptionResult: ...

    async def membership(
        self, problem: str, alphabet: Sequence[str]
    ) -> MembershipPredicate | None: ...


def _image(data: bytes) -> dict:
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": base64.b64encode(data).decode("ascii"),
        },
        "transformations": {"oversized_image": "error"},
    }


def _page_content(prepared: PreparedPage, ctx: ProblemContext) -> list[dict]:
    content = [
        {"type": "text", "text": "Image 1: her page, flattened, with numbered tags."},
        _image(prepared.marked_jpeg),
    ]
    if prepared.crop_jpeg is not None:
        content.extend(
            [
                {"type": "text", "text": "Image 2: the part that just changed."},
                _image(prepared.crop_jpeg),
            ]
        )
    content.append({"type": "text", "text": render_context(ctx, prepared)})
    return content


def _anthropic_request(
    content: list[dict], *, model: str, effort: str, schema: dict, system: str, max_tokens: int
) -> dict:
    return {
        "model": model,
        "max_tokens": max_tokens,
        "betas": [FALLBACK_BETA],
        "fallbacks": "default",
        "output_config": {
            "effort": effort,
            "format": {"type": "json_schema", "schema": deepcopy(schema)},
        },
        "system": system,
        "messages": [{"role": "user", "content": content}],
    }


def transcription_request(
    prepared: PreparedPage, ctx: ProblemContext, *, model: str, effort: str
) -> dict:
    return _anthropic_request(
        _page_content(prepared, ctx),
        model=model,
        effort=effort,
        schema=TRANSCRIPTION_SCHEMA,
        system=TRANSCRIBE_SYSTEM,
        max_tokens=TRANSCRIPTION_MAX_TOKENS,
    )


def _membership_content(problem: str, alphabet: Sequence[str]) -> list[dict]:
    # Deliberately accepts no regex, transcription or prior reader answer (P4-R11).
    return [
        {
            "type": "text",
            "text": json.dumps(
                {"problem": problem, "alphabet": list(alphabet)}, ensure_ascii=False
            ),
        }
    ]


def membership_request(problem: str, alphabet: Sequence[str], *, model: str) -> dict:
    return _anthropic_request(
        _membership_content(problem, alphabet),
        model=model,
        effort="low",
        schema=PREDICATE_SCHEMA,
        system=MEMBERSHIP_SYSTEM,
        max_tokens=MEMBERSHIP_MAX_TOKENS,
    )


def _openai_request(
    content: list[dict],
    *,
    model: str,
    effort: str,
    schema: dict,
    name: str,
    system: str,
    max_tokens: int,
) -> dict:
    inputs = []
    for block in content:
        if block["type"] == "text":
            inputs.append({"type": "input_text", "text": block["text"]})
        else:
            inputs.append(
                {
                    "type": "input_image",
                    "detail": "high",
                    "image_url": "data:image/jpeg;base64," + block["source"]["data"],
                }
            )
    return {
        "model": model,
        "instructions": system,
        "input": [{"role": "user", "content": inputs}],
        "max_output_tokens": max_tokens,
        "reasoning": {"effort": effort},
        "store": False,
        "text": {
            "format": {
                "type": "json_schema",
                "name": name,
                "strict": True,
                "schema": deepcopy(schema),
            }
        },
    }


def openai_transcription_request(
    prepared: PreparedPage, ctx: ProblemContext, *, model: str, effort: str
) -> dict:
    return _openai_request(
        _page_content(prepared, ctx),
        model=model,
        effort=effort,
        schema=TRANSCRIPTION_SCHEMA,
        name="dfa_transcription",
        system=TRANSCRIBE_SYSTEM,
        max_tokens=TRANSCRIPTION_MAX_TOKENS,
    )


def openai_membership_request(problem: str, alphabet: Sequence[str], *, model: str) -> dict:
    return _openai_request(
        _membership_content(problem, alphabet),
        model=model,
        effort="low",
        schema=PREDICATE_SCHEMA,
        name="membership_predicate",
        system=MEMBERSHIP_SYSTEM,
        max_tokens=MEMBERSHIP_MAX_TOKENS,
    )


def _anthropic_text(message) -> tuple[Status, str | None, str | None]:
    stop = getattr(message, "stop_reason", None)
    if stop == "refusal":
        category = getattr(getattr(message, "stop_details", None), "category", None)
        return "refused", None, category if category in _REFUSAL_CATEGORIES else None
    if stop == "max_tokens":
        return "failed", None, "max_tokens"
    text = next(
        (
            b.text
            for b in getattr(message, "content", []) or []
            if getattr(b, "type", None) == "text"
        ),
        None,
    )
    return ("ok", text, None) if isinstance(text, str) else ("failed", None, "missing_text")


def _openai_text(response) -> tuple[Status, str | None, str | None]:
    blocks = [
        block
        for item in getattr(response, "output", []) or []
        if getattr(item, "type", None) == "message"
        for block in getattr(item, "content", []) or []
    ]
    if any(getattr(b, "type", None) == "refusal" for b in blocks):
        return "refused", None, "refusal"
    if getattr(response, "status", None) != "completed":
        return "failed", None, "incomplete_response"
    text = next((b.text for b in blocks if getattr(b, "type", None) == "output_text"), None)
    return ("ok", text, None) if isinstance(text, str) else ("failed", None, "missing_text")


def _transcription(status: Status, text: str | None, detail: str | None) -> TranscriptionResult:
    if status != "ok":
        return TranscriptionResult(status, None, 0, detail)
    try:
        value = DfaTranscription.model_validate_json(text)
    except (ValidationError, ValueError, TypeError):
        return TranscriptionResult("failed", None, 0, "invalid_transcription")
    return TranscriptionResult("ok", value, 0)


def parse_transcription_response(message) -> TranscriptionResult:
    return _transcription(*_anthropic_text(message))


class _LiveDeepCheck:
    """Shared validation, failure handling and lifecycle; SDK I/O differs by provider."""

    async def _request(self, body: dict, operation: str):
        started = perf_counter()
        request_id = None
        try:
            if self.name == "anthropic":
                message = await self._client.beta.messages.create(**body)
                status, text, detail = _anthropic_text(message)
            else:
                message = await self._client.responses.create(**body)
                status, text, detail = _openai_text(message)
            request_id = getattr(message, "_request_id", None)
        except (anthropic.APITimeoutError, openai.APITimeoutError):
            status, text, detail = "timeout", None, "timeout"
        except (anthropic.APIError, openai.APIError) as error:
            request_id = getattr(error, "request_id", None)
            status, text, detail = "failed", None, "provider_error"
        except (ValueError, TypeError):
            status, text, detail = "failed", None, "invalid_response"
        # SDK status/validation errors may echo user data or credentials: never stringify them.
        if operation == "transcribe":
            result = _transcription(status, text, detail)
            status = result.status
        else:
            result = None
            if status == "ok":
                try:
                    result = MembershipPredicate.model_validate_json(text)
                except (ValidationError, ValueError, TypeError):
                    status = "failed"
        safe_id = str(request_id or "none").replace(self._key.get_secret_value(), "[redacted]")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", safe_id):
            safe_id = "redacted"
        _LOG.info("%s %s status=%s request_id=%s", self.name, operation, status, safe_id)
        if operation == "transcribe":
            return replace(result, ms=round((perf_counter() - started) * 1000))
        return result

    async def transcribe(self, prepared: PreparedPage, ctx: ProblemContext) -> TranscriptionResult:
        request = (
            transcription_request if self.name == "anthropic" else openai_transcription_request
        )
        return await self._request(
            request(prepared, ctx, model=self.model, effort=self.effort), "transcribe"
        )

    async def membership(self, problem: str, alphabet: Sequence[str]) -> MembershipPredicate | None:
        request = membership_request if self.name == "anthropic" else openai_membership_request
        return await self._request(request(problem, alphabet, model=self.model), "membership")

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.close()


class OpusDeepCheck(_LiveDeepCheck):
    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: SecretStr,
        model: str = "claude-opus-5-5",
        effort: Literal["low", "medium"] = "low",
        timeout_s: float = 45.0,
        client: anthropic.AsyncAnthropic | None = None,
    ):
        self.model, self.effort, self._key = model, effort, api_key
        self._owns_client = client is None
        self._client = (
            client
            if client is not None
            else anthropic.AsyncAnthropic(
                api_key=api_key.get_secret_value(), timeout=timeout_s, max_retries=1
            )
        )


class OpenAIDeepCheck(_LiveDeepCheck):
    name = "openai"

    def __init__(
        self,
        *,
        api_key: SecretStr,
        model: str = OPENAI_DEEPCHECK_MODEL,
        effort: Literal["low", "medium"] = "low",
        timeout_s: float = 45.0,
        client: openai.AsyncOpenAI | None = None,
    ):
        self.model, self.effort, self._key = model, effort, api_key
        self._owns_client = client is None
        self._client = (
            client
            if client is not None
            else openai.AsyncOpenAI(
                api_key=api_key.get_secret_value(), timeout=timeout_s, max_retries=1
            )
        )


def make_deepcheck(s: VisionSettings) -> DeepCheck:
    provider = resolve_deepcheck_provider(s)
    if provider == "anthropic":
        return OpusDeepCheck(
            api_key=s.anthropic_api_key,
            model=s.deepcheck_model,
            effort=s.deepcheck_effort,
            timeout_s=s.deepcheck_timeout_s,
        )
    if provider == "openai":
        # Task 1 defines deepcheck_model as Anthropic-only; don't send a Claude id to OpenAI.
        return OpenAIDeepCheck(
            api_key=s.openai_api_key, effort=s.deepcheck_effort, timeout_s=s.deepcheck_timeout_s
        )
    from tassel.vision.fakes.deepcheck import FixtureDeepCheck, NamedFixtureDeepCheck

    if s.fake_truth is not None:
        return FixtureDeepCheck(s.fake_truth)
    return NamedFixtureDeepCheck(s.fake_reading)
