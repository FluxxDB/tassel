"""The student's image Ada can show and mark: the latest she sent in the session's chat, with its
Set-of-Mark (``vision.image_marks``), computed once per attachment and off the event loop.

The voice bot hands it to the thinker (the marked image and its legend) and to the board context
(the ids its [[image …]] tags may name); the elements route serves the same boxes to the app,
so a mark on ``m3`` lands where the Pointer saw m3.
"""

import asyncio
import hashlib
import logging
import uuid
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass

from tassel.beats.markup import StageImage
from tassel.beats.models import DetectedElement, DetectedElements, PixelBox
from tassel.chat.store import LoadedAttachment
from tassel.vision.image_marks import ImageView, image_view

logger = logging.getLogger(__name__)

VIEWS_MAX = 16
"""Attachments whose views stay cached; an attachment's pixels never change, so its view never
goes stale, only old."""

_views: OrderedDict[tuple[str, bytes], ImageView] = OrderedDict()


async def view_of(attachment_id: str, data: bytes) -> ImageView | None:
    """The attachment's Set-of-Mark view, or None when its image won't decode. Cached by the id
    and its pixels' digest, so an id never answers for other pixels."""
    key = (attachment_id, hashlib.blake2b(data, digest_size=16).digest())
    cached = _views.get(key)
    if cached is not None:
        _views.move_to_end(key)
        return cached
    try:
        view = await asyncio.to_thread(image_view, data)
    except ValueError:
        logger.warning("Couldn't mark up the student's image %s", attachment_id)
        return None
    _views[key] = view
    while len(_views) > VIEWS_MAX:
        _views.popitem(last=False)
    return view


def detected_elements(view: ImageView) -> DetectedElements:
    """The view's numbered boxes as the beats contract carries them, in image pixels, each kept
    inside the image (scaling back from the detection size can overshoot by a rounding)."""
    items = []
    for element in view.elements:
        box = element.box
        x, y = min(box.x, view.width - 1), min(box.y, view.height - 1)
        w, h = min(box.w, view.width - x), min(box.h, view.height - y)
        items.append(
            DetectedElement(id=element.id, kind=element.kind, box=PixelBox(x=x, y=y, w=w, h=h))
        )
    return DetectedElements(width=view.width, height=view.height, items=items)


@dataclass(frozen=True)
class StudentImage:
    attachment: LoadedAttachment
    view: ImageView

    @property
    def id(self) -> str:
        return self.attachment.id

    def stage(self) -> StageImage:
        """The image as Ada's tags see it: its id, and the marker ids they may name."""
        return StageImage(self.id, detected_elements(self.view))


class LatestImage:
    """One per bot: the latest image she sent, from this bot's typed messages, or, after a
    reconnect, the newest one stored for the session."""

    def __init__(self, chat, learner_id: uuid.UUID, session_id: uuid.UUID):
        self._chat, self._learner_id, self._session_id = chat, learner_id, session_id
        self.latest: LoadedAttachment | None = None

    def sent(self, images: Sequence[LoadedAttachment]) -> None:
        if images:
            self.latest = images[-1]

    async def current(self) -> StudentImage | None:
        attachment = self.latest or await self._stored()
        if attachment is None:
            return None
        view = await view_of(attachment.id, attachment.data)
        return None if view is None else StudentImage(attachment, view)

    async def _stored(self) -> LoadedAttachment | None:
        latest = getattr(self._chat, "latest_attachment", None)
        if latest is None:
            return None
        try:
            return await latest(self._learner_id, self._session_id)
        except Exception as error:  # noqa: BLE001 - no image is a turn without one, never a failure
            logger.warning("Couldn't find the student's latest image: %s", type(error).__name__)
            return None
