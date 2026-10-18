"""Ada marks the student's image in the voice pipeline (fake providers): she types a message with
her worksheet, then "Circle the diagram on my image."; the director sends it to the thinker, the
Pointer (a fake provider) finds the diagram's marker on that image, and Ada shows the image and
circles it: image.show then image.mark beats, and an action row naming the image.

The worksheet is synthetic (tests/image_marks_fixtures.py)."""

import io

import pytest
from image_marks_fixtures import box_of, iou, textbook
from PIL import Image
from test_bot_pipeline import context, running, until
from test_chat_pipeline import FakeChat, finals, greeted, typed
from test_image_marks_turns import PointerClient

from tassel.chat.store import LoadedAttachment
from tassel.vision.image_marks import image_view
from tassel.voice.messages import OfferRequestData
from tassel.voice.pointer import Pointer
from tassel.voice.settings import VoiceSettings

pytestmark = pytest.mark.asyncio


class WorksheetChat(FakeChat):
    """Her images by id, as stored: PNGs at their own size."""

    async def load_attachments(self, learner_id, session_id, ids):
        self.asked.append((learner_id, session_id, list(ids)))
        out = []
        for i in ids:
            if i in self.images:
                with Image.open(io.BytesIO(self.images[i])) as image:
                    w, h = image.size
                out.append(LoadedAttachment(i, self.images[i], "image/png", w, h))
        return out


def beat_actions(out):
    return [
        marker["action"]
        for event in out.events()
        if event["kind"] == "beat"
        for marker in event["beat"]["markers"]
    ]


async def test_circle_the_diagram_on_my_image_shows_and_marks_it():
    scene = textbook()
    data = scene.png()
    view = image_view(data)
    truth = next(t for t in scene.truth if t.name == "diagram")
    diagram = next(e for e in view.elements if iou(box_of(e), truth.box) >= 0.5)
    x, y, w, h = truth.box
    answer = {
        "i": 0,
        "id": None,
        "box": {
            "x": x / view.width,
            "y": y / view.height,
            "w": w / view.width,
            "h": h / view.height,
        },
    }
    client = PointerClient([answer])
    chat = WorksheetChat({"a-1": data})
    ctx = context(chat=chat, request=OfferRequestData(scenario="image-marks"))
    async with running(ctx) as (bot, out):
        bot._turn_context.coordinator.pointer = Pointer(VoiceSettings(), client=client)
        await greeted(out)
        await typed(bot, "Here's my worksheet.", attachment_ids=["a-1"])
        await until(lambda: any("worksheet" in m["text"] for m in finals(out, "tutor")))
        await typed(bot, "Circle the diagram on my image.", client_id="c-2")
        await until(lambda: any(a["kind"] == "image.mark" for a in beat_actions(out)))
        await until(lambda: len(finals(out, "action")) >= 2)
        actions = [a for a in beat_actions(out) if a["kind"].startswith("image.")]
        assert [(a["kind"], a["attachmentId"]) for a in actions] == [
            ("image.show", "a-1"),
            ("image.mark", "a-1"),
        ]
        mark = actions[1]["mark"]
        assert mark["type"] == "circle" and mark["target"] == {"el": diagram.id}
        # The Pointer saw her image, numbered, in its own pixels.
        assert len(client.requests) == 1
        rows = [m["action"] for m in finals(out, "action")]
        assert rows == [
            {"kind": "view", "side": "image", "item": None, "attachment_id": "a-1"},
            {"kind": "mark", "side": "image", "item": mark["id"], "attachment_id": "a-1"},
        ]
        await until(lambda: "This is the diagram to look at." in out.text())


async def test_a_raw_image_tag_from_the_brief_lands_on_her_latest_image():
    """With no Pointer (fake providers), the brief's [[image circle m1]] still lands, checked
    against her image's markers; the image is the latest she sent, here before this bot."""
    scene = textbook()
    data = scene.png()

    class Stored(WorksheetChat):
        async def latest_attachment(self, learner_id, session_id):
            [loaded] = await self.load_attachments(learner_id, session_id, ["a-9"])
            return loaded

    ctx = context(chat=Stored({"a-9": data}), request=OfferRequestData(scenario="image-marks"))
    async with running(ctx) as (bot, out):
        await greeted(out)
        await typed(bot, "Circle the box in my picture.")
        await until(lambda: any(a["kind"] == "image.mark" for a in beat_actions(out)))
        actions = [a for a in beat_actions(out) if a["kind"].startswith("image.")]
        assert [(a["kind"], a["attachmentId"]) for a in actions] == [
            ("image.show", "a-9"),
            ("image.mark", "a-9"),
        ]
        assert actions[1]["mark"]["target"] == {"el": "m1"}
