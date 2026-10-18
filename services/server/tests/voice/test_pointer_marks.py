"""The Pointer on a synthetic handwritten page (tassel.vision.synth): "the IP she wrote" resolves
to its text-line marker, or, when no marker fits, to a box on the page. No provider calls."""

import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import cv2
import pytest
from image_marks_fixtures import FIXTURES, box_of
from pipecat.processors.aggregators.llm_context import LLMContext
from test_retest8_fixes import decision
from test_two_tier import brief

from tassel.beats.markup import BoardContext, parse_command
from tassel.beats.models import BEAT_ACTION
from tassel.vision.image_marks import image_view
from tassel.vision.page import encode_jpeg
from tassel.vision.synth import IP, scene
from tassel.vision.turn_image import _page_view, legend
from tassel.voice import thinker
from tassel.voice.pointer import RESOLUTIONS_SCHEMA, Pointer, mark_tags
from tassel.voice.settings import VoiceSettings

UNDERLINE_IP = thinker.MarkIntent(verb="underline", target="the IP she wrote")


class Client:
    """Answers every request with `marks`, as the provider's JSON content."""

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


def iou(a, b):
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return ix * iy / (a[2] * a[3] + b[2] * b[3] - ix * iy)


@pytest.fixture(scope="module")
def page():
    """The network page as a turn sees it: marked, with its drawn elements and legend."""
    s = scene("network")
    w, h = s.page.width, s.page.height
    corners = [{"x": 0, "y": 0}, {"x": w, "y": 0}, {"x": w, "y": h}, {"x": 0, "y": h}]
    row = SimpleNamespace(
        meta={"page_quad": corners}, id=uuid.uuid4(), captured_at=datetime.now(UTC)
    )
    view = _page_view(encode_jpeg(s.page.rgb, quality=95), row)
    truth = s.find(IP).box
    [ip] = [e for e in view.elements if iou((e.box.x, e.box.y, e.box.w, e.box.h), truth) >= 0.5]
    return SimpleNamespace(synth=s, view=view, ip=ip, truth=truth)


def board(page):
    ctx = BoardContext()
    page.view.set_context(ctx)
    return ctx


def normalized(page):
    x, y, w, h = page.truth
    W, H = page.view.width, page.view.height
    return {"x": x / W, "y": y / H, "w": w / W, "h": h / H}


def test_the_ip_line_is_a_drawn_label_the_legend_names(page):
    assert page.ip.kind == "label"
    assert f"{page.ip.id} label at bottom center" in legend(page.view)


@pytest.mark.asyncio
async def test_the_ip_she_wrote_resolves_to_its_marker(page):
    client = Client([{"i": 0, "id": page.ip.id, "box": None}])
    pointer = Pointer(VoiceSettings(), client=client)
    resolved = await pointer.resolve([UNDERLINE_IP], b"jpeg", legend(page.view), page.view.elements)
    assert resolved == [("underline", page.ip.id, None, None)]
    [freeze, tag] = mark_tags(resolved)
    assert (freeze, tag) == ("[[freeze]]", f"[[underline {page.ip.id}]]")
    ctx = board(page)
    action = parse_command(tag[2:-2], ctx)
    [item] = [e for e in ctx.paper_elements.detected.items if e.id == page.ip.id]
    assert iou((item.box.x, item.box.y, item.box.w, item.box.h), page.truth) >= 0.5
    # The underline goes under the IP's own ink, not under its marker's padded box.
    assert_under_the_ip(action.mark.target.box.model_dump(), page)


def assert_under_the_ip(got, page):
    x, y, w, h = page.truth
    W, H = page.view.width, page.view.height
    assert got["x"] * W == pytest.approx(x, abs=0.02 * w)
    assert got["w"] * W == pytest.approx(w, abs=0.04 * w)
    assert got["y"] * H == pytest.approx(y, abs=0.1 * h)
    assert y + h - 2 <= (got["y"] + got["h"]) * H <= y + 1.3 * h


@pytest.mark.asyncio
@pytest.mark.parametrize("answer", ["null", "unknown", "incompatible"])
async def test_a_box_when_no_marker_fits(page, answer):
    box = normalized(page)
    label = next(e for e in page.view.elements if e.kind == "label")
    mark_id = {"null": None, "unknown": "m99", "incompatible": label.id}[answer]
    # A state target can't take a far-off label, so that id is rejected too.
    target = "the state she drew" if answer == "incompatible" else "the IP she wrote"
    logs = []
    pointer = Pointer(
        VoiceSettings(),
        client=Client([{"i": 0, "id": mark_id, "box": box}]),
        log=lambda e, **d: logs.append((e, d)),
    )
    far = [e for e in page.view.elements if e.kind == "label"]
    resolved = await pointer.resolve(
        [thinker.MarkIntent(verb="underline", target=target)], b"jpeg", "", far
    )
    [(verb, where, text, n)] = resolved
    assert (verb, text, n) == ("underline", None, None)
    assert where.startswith("box=")
    [_, tag] = mark_tags(resolved)
    assert tag == f"[[underline {where}]]"
    mark = BEAT_ACTION.dump_python(parse_command(tag[2:-2], board(page)), mode="json")["mark"]
    assert_under_the_ip(mark["target"]["box"], page)
    assert any(e == "pointer_brief" and d.get("box") == where for e, d in logs)


@pytest.mark.asyncio
async def test_a_valid_marker_wins_over_a_box(page):
    client = Client([{"i": 0, "id": page.ip.id, "box": {"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1}}])
    pointer = Pointer(VoiceSettings(), client=client)
    assert await pointer.resolve([UNDERLINE_IP], b"jpeg", "", page.view.elements) == [
        ("underline", page.ip.id, None, None)
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "box",
    [
        {"x": 0.9, "y": 0.5, "w": 0.3, "h": 0.05},  # runs off the page
        {"x": -0.2, "y": 0.5, "w": 0.3, "h": 0.05},
        {"x": 0.4, "y": 0.5, "w": 0.0, "h": 0.05},
        {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},  # the whole page is no target
    ],
)
async def test_a_bad_box_resolves_to_nothing(page, box):
    logs = []
    pointer = Pointer(
        VoiceSettings(),
        client=Client([{"i": 0, "id": None, "box": box}]),
        log=lambda e, **d: logs.append((e, d)),
    )
    assert await pointer.resolve([UNDERLINE_IP], b"jpeg", "", page.view.elements) == []
    assert any(e == "reject" and d["source"] == "pointer" for e, d in logs)


@pytest.mark.asyncio
async def test_an_old_reply_without_a_box_still_resolves(page):
    pointer = Pointer(VoiceSettings(), client=Client([{"i": 0, "id": page.ip.id}]))
    assert await pointer.resolve([UNDERLINE_IP], b"jpeg", "", page.view.elements) == [
        ("underline", page.ip.id, None, None)
    ]
    pointer = Pointer(VoiceSettings(), client=Client([{"i": 0, "id": None}]))
    assert await pointer.resolve([UNDERLINE_IP], b"jpeg", "", page.view.elements) == []


@pytest.mark.asyncio
async def test_the_request_asks_for_a_box_in_strict_json():
    client = Client([])
    pointer = Pointer(VoiceSettings(), client=client)
    await pointer.resolve([UNDERLINE_IP], b"jpeg", "", [])
    response_format = client.requests[0]["response_format"]["json_schema"]
    assert response_format["strict"] is True
    assert response_format["schema"] == RESOLUTIONS_SCHEMA

    def objects(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                yield node
            for value in node.values():
                yield from objects(value)
        elif isinstance(node, list):
            for value in node:
                yield from objects(value)

    found = list(objects(RESOLUTIONS_SCHEMA))
    assert len(found) == 3  # the reply, a mark and its box
    for node in found:
        assert node["required"] == list(node["properties"])
        assert node["additionalProperties"] is False
    assert "box" in json.dumps(RESOLUTIONS_SCHEMA) and '"default"' not in json.dumps(
        RESOLUTIONS_SCHEMA
    )
    assert "box" in client.requests[0]["messages"][0]["content"]


@pytest.mark.asyncio
async def test_the_coordinator_delivers_a_box_mark_that_validates(page):
    base = brief().model_dump()
    base["paper"] = []
    base["marks"] = [{"verb": "underline", "target": "the IP she wrote"}]

    class Thinker:
        async def think(self, messages, effort=None):
            return thinker.GuidanceBrief.model_validate(base)

        async def close(self):
            pass

    ctx = board(page)
    # A box over blank paper: no marker matches it, so it stays a box (a box on the IP's
    # line snaps to its marker; see the next test).
    blank = {"x": 0.02, "y": 0.9, "w": 0.1, "h": 0.05}
    pointer = Pointer(VoiceSettings(), client=Client([{"i": 0, "id": None, "box": blank}]))
    events = []
    transcript = SimpleNamespace(record=lambda e, d: events.append((e, d)))
    c = thinker.TutorCoordinator(Thinker(), ctx, pointer=pointer, transcript=transcript)
    pointer.log = c.log

    async def marked_page():
        return b"jpeg", legend(page.view)

    await c.prepare(
        LLMContext([{"role": "user", "content": "underline the IP I wrote"}]),
        "underline the IP I wrote",
        decision=decision(action="mark_paper"),
        page=marked_page,
    )
    result = await c.result()
    assert result.paper[0] == "[[freeze]]"
    [tag] = result.paper[1:]
    assert tag.startswith("[[underline box=")
    await c.close()


@pytest.mark.asyncio
async def test_a_box_a_marker_mostly_matches_snaps_to_that_marker(page):
    """Real-token eval: the Pointer gave a box over two thirds of the IP while its whole-line
    marker was there; the mark then missed the rest of the line. A box that a detected marker
    matches well (IoU ≥ 0.4) lands on that marker, which follows the ink."""
    x, y, w, h = page.truth
    short = {"x": x / page.view.width, "y": y / page.view.height}
    short |= {"w": 0.67 * w / page.view.width, "h": h / page.view.height}
    client = Client([{"i": 0, "id": None, "box": short}])
    pointer = Pointer(VoiceSettings(), client=client)
    size = (page.view.width, page.view.height)
    resolved = await pointer.resolve(
        [UNDERLINE_IP], b"jpeg", legend(page.view), page.view.elements, size=size
    )
    assert resolved == [("underline", page.ip.id, None, None)]
    # A box over blank paper, far from every marker, stays a box.
    blank = {"x": 0.02, "y": 0.9, "w": 0.1, "h": 0.05}
    client.marks = [{"i": 0, "id": None, "box": blank}]
    [(_, where, _, _)] = await pointer.resolve(
        [UNDERLINE_IP], b"jpeg", "", page.view.elements, size=size
    )
    assert where.startswith("box=")


@pytest.mark.asyncio
@pytest.mark.parametrize("name", FIXTURES)
@pytest.mark.parametrize("scale", [1, 2])
async def test_student_image_intents_snap_to_original_image_pixels(name, scale):
    scene = FIXTURES[name]()
    if scale != 1:
        from dataclasses import replace

        scene.rgb = cv2.resize(scene.rgb, None, fx=scale, fy=scale)
        scene.truth = [replace(t, box=tuple(v * scale for v in t.box)) for t in scene.truth]
    view = image_view(scene.png())
    targets = [next(t for t in scene.truth if t.name == name) for name in ("line 2", "diagram")]
    expected = [next(e for e in view.elements if iou(box_of(e), t.box) >= 0.5) for t in targets]
    # The fake model returns independently rendered truth boxes, not detector boxes. This
    # exercises the real Pointer's normalized-to-pixel snapping, including a resized JPEG.
    answers = []
    for i, t in enumerate(targets):
        x, y, w, h = t.box
        answers.append(
            {
                "i": i,
                "id": None,
                "box": {
                    "x": x / view.width,
                    "y": y / view.height,
                    "w": w / view.width,
                    "h": h / view.height,
                },
            }
        )
    pointer = Pointer(VoiceSettings(), client=Client(answers))
    try:
        resolved = await pointer.resolve(
            [
                thinker.MarkIntent(verb="underline", target="the second line"),
                thinker.MarkIntent(verb="circle", target="the diagram"),
            ],
            view.marked_jpeg,
            view.legend_text,
            view.elements,
            size=(view.width, view.height),
        )
        assert resolved == [
            ("underline", expected[0].id, None, None),
            ("circle", expected[1].id, None, None),
        ]
    finally:
        await pointer.close()
