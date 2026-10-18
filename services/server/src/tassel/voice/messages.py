"""The voice event contract between the bot and the desktop app, beside RTVI's own messages.

It mirrors ``packages/shared/src/voice/messages.ts``, and both sides' tests check the examples in
``packages/shared/src/voice/fixtures.json``. Server events travel as RTVI server messages whose
data is ``{"tassel": event}`` (see ``envelope``); the app's client messages have the type
``tassel`` and an event as their data.

Every model forbids fields the contract doesn't declare and refuses coercion (``"yes"`` is not a
boolean), so a message either matches or is refused. The one exception: a fractional time rounds
to whole milliseconds.
"""

import math
from typing import Annotated, Final, Literal, TypedDict

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, TypeAdapter

from tassel.beats.models import BeatAction, BeatDoc
from tassel.models import Lang

ENVELOPE: Final = "tassel"

# Later tasks import these rather than redefine them. Sensitivity is how readily the student's
# speech interrupts Ada, shown as Fewer · Normal · Instant.
Sensitivity = Literal["low", "normal", "high"]
SttKind = Literal["flux", "nova-3", "fake"]


def _whole_ms(value: object) -> object:
    """Rounds a finite fractional time to whole milliseconds; anything else validates as sent.

    The app times with ``performance.now()`` and the server with nanosecond clocks, so times can
    arrive fractional.
    """
    if isinstance(value, float) and math.isfinite(value):
        return round(value)
    return value


# A duration in whole milliseconds.
Ms = Annotated[int, BeforeValidator(_whole_ms)]


class _Message(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


# Server events, bot to app.


class RouteEvent(_Message):
    """The providers serving this connection, sent once it's up."""

    kind: Literal["route"] = "route"
    lang: Lang
    stt: SttKind
    llm: Literal["openrouter", "openai", "fake"]
    tts: Literal["elevenlabs", "fake"]


class TitleEvent(_Message):
    kind: Literal["title"] = "title"
    title: str
    subject: str | None


class BeatEvent(_Message):
    kind: Literal["beat"] = "beat"
    beat: BeatDoc


class BoardSnapshotEvent(_Message):
    kind: Literal["board-snapshot"] = "board-snapshot"


class ActionsEvent(_Message):
    kind: Literal["actions"] = "actions"
    actions: list[BeatAction]


class StageEvent(_Message):
    kind: Literal["stage"] = "stage"
    view: Literal["paper", "board", "split"]


class StageHintEvent(_Message):
    kind: Literal["stage-hint"] = "stage-hint"
    side: Literal["paper", "board"]


class LanguageEvent(_Message):
    kind: Literal["language"] = "language"
    lang: Lang


class PaperFrameEvent(_Message):
    """Asks the app for her paper as it is now: the student just started a turn. The app
    uploads the current camera frame with ``trigger="turn"``, and the turn waits for it."""

    kind: Literal["paper-frame"] = "paper-frame"


class VadEvent(_Message):
    kind: Literal["vad"] = "vad"
    speaking: bool


class BackchannelEvent(_Message):
    """A short reply ("uh-huh", "네") heard while Ada spoke, which didn't interrupt her."""

    kind: Literal["backchannel"] = "backchannel"
    text: str


class TurnMetrics(_Message):
    """One turn's server-side timings; None where the turn had no such step."""

    turn: int
    lang: Lang
    input: Literal["voice", "typed"]
    stt_ms: Ms | None
    llm_ttfb_ms: Ms | None
    tts_ttfb_ms: Ms | None
    server_ttfa_ms: Ms | None
    interrupted: bool
    budget_ms: int


class TurnMetricsEvent(_Message):
    kind: Literal["turn-metrics"] = "turn-metrics"
    metrics: TurnMetrics


# Client events, app to bot.


class StageStateEvent(_Message):
    kind: Literal["stage-state"] = "stage-state"
    view: Literal["paper", "board", "split"]
    pinned: Literal["paper", "board", "split"] | None = None
    frozen: bool
    page_revision: int = Field(ge=0)


class PushToTalkEvent(_Message):
    kind: Literal["ptt"] = "ptt"
    enabled: bool
    held: bool


class SensitivityEvent(_Message):
    kind: Literal["sensitivity"] = "sensitivity"
    level: Sensitivity


class ClientMetricsEvent(_Message):
    """What the app measured: first audio, or barge-in and yield; None where it wasn't measured.

    ``sensitivity`` is the setting it was measured at, which picks the silence budget.
    """

    kind: Literal["client-metrics"] = "client-metrics"
    ttfa_ms: Ms | None
    barge_in_ms: Ms | None
    yield_ms: Ms | None
    sensitivity: Sensitivity


class OfferRequestData(_Message):
    """The RTVI ``requestData`` of a voice offer."""

    # The fake LLM's scenario; None means the server's default.
    scenario: str | None = None
    sensitivity: Sensitivity = "normal"
    ptt: bool = False


ServerEvent = Annotated[
    RouteEvent
    | TurnMetricsEvent
    | BackchannelEvent
    | TitleEvent
    | StageEvent
    | StageHintEvent
    | LanguageEvent
    | VadEvent
    | BeatEvent
    | PaperFrameEvent
    | BoardSnapshotEvent
    | ActionsEvent,
    Field(discriminator="kind"),
]
ClientEvent = Annotated[
    PushToTalkEvent | SensitivityEvent | ClientMetricsEvent | StageStateEvent,
    Field(discriminator="kind"),
]
SERVER_EVENTS: Final = TypeAdapter(ServerEvent)
CLIENT_EVENTS: Final = TypeAdapter(ClientEvent)


class VoiceBudgets(TypedDict):
    ttfa_ms: dict[Lang, int]
    yield_ms: int
    silence_ms: int
    silence_instant_ms: int


# The latency budgets (spec §2, P2-R5): first audio per language; and on barge-in, from the
# student's speech onset, how soon Ada yields (ducks), and how soon she is silent on Normal and
# Fewer, and on Instant.
VOICE_BUDGETS: Final[VoiceBudgets] = {
    "ttfa_ms": {"en": 1200, "es": 1200, "ko": 1400},
    "yield_ms": 300,
    "silence_ms": 600,
    "silence_instant_ms": 300,
}

# Router-relative: the app mounts the voice router under /v1.
OFFER_ROUTE: Final = "/sessions/{session_id}/voice/offer"
ICE_SERVERS_ROUTE: Final = "/voice/ice-servers"

LANGUAGE_SWITCH_PREFIX: Final = "[language switch]"


def is_note(text: str) -> bool:
    """True for a user-role message the server injected rather than the student said.

    Notes start with ``[``: the language-switch note, and later the vision notes.
    """
    return text.startswith("[")


def envelope(event: BaseModel) -> dict:
    """An RTVI server message's data for ``event``: ``{"tassel": <the event as JSON>}``."""
    return {ENVELOPE: event.model_dump(mode="json")}
