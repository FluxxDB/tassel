"""Ada marks the student's own image (one she sent in the chat), the way she marks her paper:
the director sends "underline the second line in my screenshot" to the thinker as mark_image,
the thinker sees the latest image with its numbered candidates, its marks in words go through
the Pointer on that image, and they come back as [[image show]] then [[image VERB mN]].

Every image is synthetic (tests/image_marks_fixtures.py); the Pointer's provider is a fake.
"""

import asyncio
import base64
import json
import uuid
from types import SimpleNamespace

import pytest
from image_marks_fixtures import box_of, iou, textbook
from pipecat.processors.aggregators.llm_context import LLMContext

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.beats.models import BEAT_ACTION
from tassel.chat.store import LoadedAttachment
from tassel.chat.student_image import StudentImage, view_of
from tassel.voice import thinker
from tassel.voice.action_checker import allowed, talker_allowed
from tassel.voice.director import Decision, certain, guard, rules
from tassel.voice.pointer import Pointer
from tassel.voice.settings import VoiceSettings
from tassel.voice.stage import StageManager

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")


def decision(**values):
    base = dict(
        focus="paper", needs_vision=False, route="thinker", action="mark_image", refers_to="image"
    )
    return Decision(**{**base, **values})


# The director


@pytest.mark.parametrize(
    "text",
    [
        "Underline the second line in my screenshot.",
        "Can you circle the diagram on my image?",
        "Circle the formula in the picture I sent",
        "Mark the mistake on my photo, please.",
    ],
)
def test_marking_her_image_is_mark_image_for_the_thinker(text):
    got = rules(text, focus="board")
    assert (got.action, got.refers_to, got.route, got.needs_vision) == (
        "mark_image",
        "image",
        "thinker",
        False,
    )
    # The words settle it: no director model call.
    assert certain(text) == guard(text, got)
    # A model that heard a board drawing is corrected.
    drew = Decision(
        focus="board", needs_vision=False, route="talker", action="draw_board", refers_to="board"
    )
    fixed = guard(text, drew)
    assert (fixed.action, fixed.refers_to, fixed.route) == ("mark_image", "image", "thinker")


def test_a_draw_request_sent_with_an_image_is_about_that_image():
    text = "Circle the diagram"
    assert rules(text).action == "draw_board"
    got = rules(text, image=True)
    assert (got.action, got.refers_to) == ("mark_image", "image")
    assert guard(text, rules(text), image=True).action == "mark_image"
    # Naming her paper or the board still means them.
    assert rules("Circle the diagram on my paper", image=True).action == "mark_paper"
    assert rules("Draw the diagram on the board", image=True).action == "draw_board"


def test_the_big_picture_is_not_her_image():
    assert rules("Can you explain the big picture here?").refers_to != "image"


def test_her_paper_wins_over_a_photo_on_it():
    assert rules("Circle the photo on my paper").action == "mark_paper"


def test_taking_marks_off_her_image_is_image_work_not_a_board_erase():
    got = guard(
        "Remove your marks from my screenshot", rules("Remove your marks from my screenshot")
    )
    assert (got.action, got.refers_to, got.route) == ("mark_image", "image", "thinker")


def test_a_question_about_her_image_goes_to_the_thinker_without_her_paper():
    got = guard("What does my screenshot say?", rules("What does my screenshot say?"))
    assert (got.refers_to, got.route, got.needs_vision) == ("image", "thinker", False)
    assert got.action != "mark_image"


def test_her_image_never_needs_her_paper():
    assert decision(needs_vision=True).needs_vision is False


# What may draw where


def test_image_actions_only_where_the_turn_points_at_her_image():
    on_image = decision()
    assert allowed("image.mark", on_image) and allowed("image.show", on_image)
    assert not allowed("paper.mark", on_image) and not allowed("board.automaton", on_image)
    explain = decision(action="explain")
    assert allowed("image.mark", explain)
    for other in (
        decision(action="mark_paper", refers_to="paper"),
        decision(action="draw_board", refers_to="board"),
        decision(action="explain", refers_to="conversation"),
    ):
        assert not allowed("image.mark", other)
    # The fast talker never marks her image: it has no numbered candidates.
    assert not talker_allowed("image.mark", on_image)


# The stage


def test_a_turn_on_her_image_brings_the_paper_panel_in_beside_the_board():
    stage = StageManager()
    stage.view = stage.student_view = "board"
    assert stage.on_turn(decision(), now=100.0) == "split"


def test_a_brief_that_marks_her_image_needs_the_paper_panel():
    stage = StageManager()
    stage.view = stage.student_view = "board"
    brief = thinker.GuidanceBrief.model_validate(
        {**_brief(), "image": ["[[image show]]", "[[image circle m1]]"]}
    )
    assert stage.on_brief(brief, decision(), now=100.0) == "split"


# The thinker and the Pointer, on a synthetic textbook page she sent


class PointerClient:
    """Answers the Pointer with `marks`, as the provider's JSON content."""

    def __init__(self, marks):
        self.marks = marks
        self.requests = []
        self.chat = SimpleNamespace(completions=self)

    async def create(self, **request):
        self.requests.append(request)
        content = json.dumps({"marks": self.marks})
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))], usage=None
        )

    async def close(self):
        pass


class Thinker:
    def __init__(self, **brief):
        self.brief = brief
        self.seen = []

    async def think(self, messages, effort=None):
        self.seen.append(messages)
        return thinker.GuidanceBrief.model_validate({**_brief(), **self.brief})

    async def close(self):
        pass


def _brief():
    return dict(
        page="",
        intent="mark her image",
        diagnosis="",
        plan=["Point at it"],
        say="This is the line to look at.",
        board=[],
        paper=[],
        confidence=0.9,
        followups=[],
    )


@pytest.fixture(scope="module")
def scene():
    return textbook()


@pytest.fixture
def sent(scene):
    data = scene.png()
    attachment = LoadedAttachment(str(uuid.uuid4()), data, "image/png", 1000, 850)
    view = asyncio.run(view_of(attachment.id, data))
    return StudentImage(attachment, view)


def truth_answer(scene, sent, name, i=0):
    """The fake Pointer's answer: the truth box of `name`, normalized; never a detector id."""
    x, y, w, h = next(t for t in scene.truth if t.name == name).box
    W, H = sent.view.width, sent.view.height
    return {"i": i, "id": None, "box": {"x": x / W, "y": y / H, "w": w / W, "h": h / H}}


def element_for(scene, sent, name):
    truth = next(t for t in scene.truth if t.name == name)
    return next(e for e in sent.view.elements if iou(box_of(e), truth.box) >= 0.5)


def coordinator(think, client, board=None):
    events = []
    transcript = SimpleNamespace(record=lambda event, data: events.append((event, data)))
    pointer = Pointer(VoiceSettings(), client=client)
    c = thinker.TutorCoordinator(
        think, board or BoardContext(), pointer=pointer, transcript=transcript
    )
    pointer.log = c.log
    return c, events


async def run(c, text, sent, *, attachments=None, turn=None):
    async def latest():
        return sent

    await c.prepare(
        LLMContext([{"role": "user", "content": text}]),
        text,
        decision=turn or decision(),
        attachments=attachments,
        student_image=latest,
    )
    return await c.result()


@pytest.mark.asyncio
async def test_underline_the_second_line_resolves_to_its_marker_and_shows_the_image(scene, sent):
    think = Thinker(image_marks=[{"verb": "underline", "target": "the second line"}])
    client = PointerClient([truth_answer(scene, sent, "line 2")])
    c, _ = coordinator(think, client)
    result = await run(c, "Underline the second line in my screenshot.", sent)
    line = element_for(scene, sent, "line 2")
    assert result.image == ["[[image show]]", f"[[image underline {line.id}]]"]
    assert result.paper == [] and result.board == []
    # The Pointer saw the marked image with its legend, sized in the image's own pixels.
    request = client.requests[0]
    payload = json.loads(request["messages"][1]["content"][0]["text"])
    assert payload["legend"] == sent.view.legend_text
    assert payload["intents"] == [
        {"verb": "underline", "target": "the second line", "text": None, "n": None}
    ]
    url = request["messages"][1]["content"][1]["image_url"]["url"]
    assert base64.b64decode(url.split(",", 1)[1]) == sent.view.marked_jpeg
    # Ada's tags now act on that image.
    assert c.board.image.id == sent.id
    await c.close()


@pytest.mark.asyncio
async def test_the_thinker_sees_her_latest_image_marked_with_its_legend(scene, sent):
    think = Thinker()
    c, _ = coordinator(think, PointerClient([]))
    await run(c, "What's wrong in my screenshot?", sent, turn=decision(action="explain"))
    [messages] = think.seen
    user = next(m for m in reversed(messages) if m["role"] == "user")
    texts = [b["text"] for b in user["content"] if b["type"] == "text"]
    images = [b["image_url"]["url"] for b in user["content"] if b["type"] == "image_url"]
    assert texts[0] == "What's wrong in my screenshot?"
    assert any("Student-sent image" in t for t in texts)
    assert any(sent.view.legend_text in t and "[image]" in t for t in texts)
    assert [base64.b64decode(u.split(",", 1)[1]) for u in images] == [sent.view.marked_jpeg]
    await c.close()


@pytest.mark.asyncio
async def test_the_image_she_sent_with_this_message_is_shown_marked_once(scene, sent):
    think = Thinker()
    c, _ = coordinator(think, PointerClient([]))
    await run(c, "Circle the diagram", sent, attachments=[sent.attachment])
    [messages] = think.seen
    user = next(m for m in reversed(messages) if m["role"] == "user")
    images = [b["image_url"]["url"] for b in user["content"] if b["type"] == "image_url"]
    assert [base64.b64decode(u.split(",", 1)[1]) for u in images] == [sent.view.marked_jpeg]
    await c.close()


@pytest.mark.asyncio
async def test_marks_in_words_on_an_image_turn_go_on_the_image(scene, sent):
    """A thinker used to paper turns may put her image's targets in marks: on a mark_image turn
    they are the image's."""
    think = Thinker(marks=[{"verb": "circle", "target": "the diagram"}])
    c, _ = coordinator(think, PointerClient([truth_answer(scene, sent, "diagram")]))
    result = await run(c, "Circle the diagram on my image.", sent)
    figure = element_for(scene, sent, "diagram")
    assert result.image == ["[[image show]]", f"[[image circle {figure.id}]]"]
    assert result.paper == []
    await c.close()


@pytest.mark.asyncio
async def test_raw_image_tags_are_checked_against_the_images_markers(scene, sent):
    known = sent.view.elements[0].id
    think = Thinker(image=[f"[[image circle {known}]]", "[[image circle m99]]", "[[circle m1]]"])
    c, events = coordinator(think, PointerClient([]))
    result = await run(c, "Circle the title on my image.", sent)
    assert result.image == ["[[image show]]", f"[[image circle {known}]]"]
    rejected = [d.get("text") for e, d in events if e == "reject"]
    assert "[[image circle m99]]" in rejected
    await c.close()


@pytest.mark.asyncio
async def test_clearing_her_image_needs_no_show(sent):
    c, _ = coordinator(Thinker(image=["[[image clear]]"]), PointerClient([]))
    result = await run(c, "Clear your marks on my image.", sent)
    assert result.image == ["[[image clear]]"]
    await c.close()


@pytest.mark.asyncio
async def test_without_an_image_she_hears_why_and_nothing_is_marked():
    think = Thinker(image_marks=[{"verb": "circle", "target": "the diagram"}])
    client = PointerClient([])
    c, _ = coordinator(think, client)
    result = await run(c, "Circle the diagram on my image.", None)
    assert result.image == [] and client.requests == []
    assert result.say
    await c.close()


@pytest.mark.asyncio
async def test_the_image_tags_play_as_beats_on_that_image(scene, sent):
    think = Thinker(image_marks=[{"verb": "underline", "target": "the second line"}])
    c, _ = coordinator(think, PointerClient([truth_answer(scene, sent, "line 2")]))
    result = await run(c, "Underline the second line in my screenshot.", sent)
    stream = MarkupStream(c.board)
    sentences = stream.feed(thinker.compose(result)) + stream.flush()
    actions = [BEAT_ACTION.dump_python(a, mode="json") for s in sentences for _, a in s.anchors]
    line = element_for(scene, sent, "line 2")
    assert [(a["kind"], a.get("attachmentId")) for a in actions] == [
        ("image.show", sent.id),
        ("image.mark", sent.id),
    ]
    assert actions[1]["mark"]["target"] == {"el": line.id}
    await c.close()


def test_the_thinker_is_told_how_to_mark_her_image():
    from tassel.voice.prompts import thinker_system_prompt

    prompt = thinker_system_prompt(thinker.GuidanceBrief.model_json_schema())
    assert "image_marks" in prompt and "[image]" in prompt
    assert "[[image clear]]" in prompt
    # A turn about her image gets its rung.
    assert "image_marks" in thinker.RUNGS[("mark_image", "paper")]


def test_the_director_is_told_her_image_is_not_her_paper():
    import inspect

    from tassel.voice import director

    source = inspect.getsource(director.Director.decide)
    assert "mark_image" in source and "sent_image" in source


def test_image_tags_written_in_say_are_lifted_into_the_image():
    brief = thinker.GuidanceBrief.model_validate(
        {**_brief(), "say": "Here. [[image circle m2]] This line."}
    )
    lifted = thinker.lift_say_tags(brief)
    assert lifted.image == ["[[image circle m2]]"] and lifted.paper == []
    assert "[[" not in lifted.say


@pytest.mark.parametrize(
    ("lang", "line"),
    [("en", "Take a look at your image."), ("es", "Mira tu imagen."), ("ko", "이미지를 보세요.")],
)
def test_a_reply_that_only_marks_her_image_still_has_words(lang, line):
    brief = thinker.GuidanceBrief.model_validate(
        {**_brief(), "image": ["[[image show]]", "[[image circle m1]]"]}
    ).model_copy(update={"say": ""})
    assert thinker.fill_silence(brief, lang).say == line


def test_a_solve_or_draw_request_sent_with_an_image_stays_on_the_board():
    """Merge review: "Can you show me the answer?" with her screenshot attached asks Ada to solve
    it, which she draws on the board; only a mark verb (circle, underline…) or naming the image
    points at the image itself."""
    for text in ("Can you show me the answer?", "Draw a DFA for this"):
        got = guard(text, rules(text, image=True), image=True)
        assert got.refers_to != "image" and got.action != "mark_image", text
    assert rules("Underline the second line", image=True).action == "mark_image"
    assert rules("Show me where on the picture", image=True).refers_to == "image"


# Live eval 20261018-133513: the thinker never saw her image on two of three turns (a dropped
# upload, retried without it), answered "my view didn't come through", and on a mark_image turn
# asked a question instead of marking.


@pytest.mark.asyncio
async def test_a_dropped_image_upload_is_retried_with_the_image_before_going_without():
    import httpx
    from openai import APIConnectionError

    calls = []

    class Completions:
        def __init__(self, failures):
            self.failures = failures

        async def create(self, **request):
            calls.append(request)
            if len(calls) <= self.failures:
                raise APIConnectionError(request=httpx.Request("POST", "https://example.test"))
            content = json.dumps(_brief())
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))], usage=None
            )

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Circle the state on my image"},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,abc"}},
            ],
        }
    ]
    logged = []
    once = thinker.Thinker(
        VoiceSettings(openai_api_key="fake"),
        client=SimpleNamespace(chat=SimpleNamespace(completions=Completions(1))),
    )
    once.log = lambda event, **data: logged.append((event, data))
    assert (await once.think(messages)).say
    assert len(calls) == 2 and "image_url" in str(calls[1])
    assert "view didn't come through" not in str(calls[1])
    assert ("thinker_retry", {"reason": "APIConnectionError", "images": True}) in logged
    # Dropped twice: then without it, from the notes, as before.
    calls.clear()
    twice = thinker.Thinker(
        VoiceSettings(openai_api_key="fake"),
        client=SimpleNamespace(chat=SimpleNamespace(completions=Completions(2))),
    )
    assert (await twice.think(messages)).say
    assert len(calls) == 3 and "image_url" not in str(calls[2])


class EffortThinker(Thinker):
    settings = VoiceSettings()

    def __init__(self, **brief):
        super().__init__(**brief)
        self.efforts = []

    async def think(self, messages, effort=None):
        self.efforts.append(effort)
        return await super().think(messages, effort)


@pytest.mark.asyncio
async def test_a_mark_image_turn_thinks_at_the_draw_effort(sent):
    think = EffortThinker()
    c, _ = coordinator(think, PointerClient([]))
    await run(c, "Circle the diagram on my image.", sent)
    assert think.efforts == [VoiceSettings().thinker_draw_effort] != [None]
    await c.close()
    explain = EffortThinker()
    c, _ = coordinator(explain, PointerClient([]))
    await run(c, "What's in my screenshot?", sent, turn=decision(action="explain"))
    assert explain.efforts == [None]
    await c.close()


@pytest.mark.asyncio
async def test_a_mark_image_brief_that_withholds_the_mark_still_marks_what_she_asked(scene, sent):
    """The thinker answered with a question and no marks: her own words go to the Pointer, and
    the closest element is marked."""
    think = Thinker(say="Which circle do your arrows lead to?")
    client = PointerClient([truth_answer(scene, sent, "diagram")])
    c, events = coordinator(think, client)
    result = await run(c, "Circle the diagram on my image.", sent)
    figure = element_for(scene, sent, "diagram")
    assert result.image == ["[[image show]]", f"[[image circle {figure.id}]]"]
    payload = json.loads(client.requests[0]["messages"][1]["content"][0]["text"])
    assert payload["intents"] == [
        {"verb": "circle", "target": "the diagram", "text": None, "n": None}
    ]
    assert ("image_mark_fallback", {"verb": "circle", "target": "the diagram"}) in events
    await c.close()


@pytest.mark.parametrize(
    ("text", "verb", "target"),
    [
        ("Now underline the arrow out of q2 in my screenshot.", "underline", "the arrow out of q2"),
        ("Circle the diagram on my image.", "circle", "the diagram"),
        ("Circle the state on my image that should be accepting.", "circle", None),
        ("Can you mark the mistake in my picture?", "circle", "the mistake"),
        ("Cross out the wrong line in my photo", "strike", "the wrong line"),
    ],
)
def test_her_words_as_a_mark_in_words(text, verb, target):
    intent = thinker.intent_from_words(text)
    assert intent.verb == verb
    if target is not None:
        assert intent.target == target
    else:
        assert "state" in intent.target and "accepting" in intent.target
    assert len(intent.target) <= 80


def test_the_thinker_never_withholds_a_mark_she_asked_for():
    from tassel.voice.prompts import thinker_system_prompt

    prompt = thinker_system_prompt(thinker.GuidanceBrief.model_json_schema())
    assert "never withhold" in prompt
    assert "never withhold" in thinker.RUNGS[("mark_image", "paper")]
