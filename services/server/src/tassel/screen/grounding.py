"""Set-of-Mark grounding of a draw_screen target on the delivered frame, as paper and images.

The frame is marked locally (numbered badges on its text lines, figures and cells); the
pointer model picks a badge id, or a box when nothing fits, and either becomes the mark's
geometry in fractions of the whole delivered image. The talker never guesses coordinates.
"""

import asyncio

from tassel.beats.markup import MarkupError, paper_box
from tassel.vision.image_marks import ImageView, image_view
from tassel.voice.pointer import Box, MarkIntent, Pointer

_VERBS = {"pointer": "check", "circle": "circle", "rectangle": "circle", "underline": "underline"}


class ScreenMarks:
    """One marked view per delivered frame: a new frame renumbers its markers."""

    def __init__(self):
        self.frame_id: str | None = None
        self.view: ImageView | None = None

    async def view_for(self, frame_id: str, image: bytes) -> ImageView:
        if self.view is None or self.frame_id != frame_id:
            self.view = await asyncio.to_thread(image_view, image)
            self.frame_id = frame_id
        return self.view


def element_box(view: ImageView, mark_id: str) -> Box | None:
    """A marker's box as fractions of the delivered image, whatever its pixel scale."""
    element = next((e for e in view.elements if e.id == mark_id), None)
    if element is None or view.width <= 0 or view.height <= 0:
        return None
    return Box(
        x=element.box.x / view.width,
        y=element.box.y / view.height,
        w=element.box.w / view.width,
        h=element.box.h / view.height,
    )


async def ground(pointer: Pointer, kind: str, target: str, view: ImageView) -> Box | None:
    """Where ``target`` is on this frame, or None when the pointer finds nothing it trusts."""
    intents = [MarkIntent(verb=_VERBS.get(kind, "circle"), target=target[:80])]
    resolved = await pointer.resolve(
        intents, view.marked_jpeg, view.legend_text, view.elements, size=(view.width, view.height)
    )
    if not resolved:
        return None
    _verb, hit, _text, _n = resolved[0]
    if not isinstance(hit, str):
        return None
    if hit.startswith("box="):
        try:
            region = paper_box(hit)
        except MarkupError:
            return None
        return Box(x=region["x"], y=region["y"], w=region["w"], h=region["h"])
    return element_box(view, hit)
