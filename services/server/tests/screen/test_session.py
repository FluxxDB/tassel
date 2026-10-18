import pytest

from tassel.screen.session import ScreenSession


def test_reset_invalidates_pending_frame_and_marks():
    screen = ScreenSession()
    screen.control(source="display", epoch=1, active=True)
    assert screen.matches("display", 1)
    screen.control(source="display", epoch=2, active=True)
    assert not screen.matches("display", 1)
    assert screen.matches("display", 2)
    assert screen.frame is None


def test_late_control_cannot_reactivate_old_source():
    screen = ScreenSession()
    screen.control(source="new", epoch=4, active=False)
    screen.control(source="old", epoch=3, active=True)
    assert not screen.active
    assert screen.source == "new"


@pytest.mark.asyncio
async def test_reset_cancels_attached_work_before_ack():
    screen = ScreenSession()
    calls = []

    async def cancel():
        calls.append(screen.epoch)

    screen.cancel = cancel
    await screen.reset(source="display", epoch=3, active=True)
    assert calls == [3]
    await screen.reset(source="display", epoch=3, active=True)
    assert calls == [3]


@pytest.mark.asyncio
async def test_fresh_frame_wait_is_invalidated_by_reset():
    import asyncio
    from datetime import UTC, datetime

    screen = ScreenSession()
    screen.control(source="display", epoch=1, active=True)
    waiting = asyncio.create_task(screen.fresh(datetime.now(UTC)))
    await asyncio.sleep(0)
    await screen.reset(source="display", epoch=2, active=True)
    assert await asyncio.wait_for(waiting, 0.2) is None


@pytest.mark.asyncio
async def test_duplicate_reset_retries_failed_cancellation_instead_of_acknowledging_it():
    screen = ScreenSession()
    calls = 0

    async def cancel():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise TimeoutError()

    screen.cancel = cancel
    with pytest.raises(TimeoutError):
        await screen.reset(source="display", epoch=1, active=True)
    assert not screen.matches("display", 1)
    await screen.reset(source="display", epoch=1, active=True)
    assert screen.matches("display", 1)
    assert calls == 2


@pytest.mark.asyncio
async def test_turn_caption_uses_actual_frame_dimensions_and_clears_stale_grounding():
    from datetime import UTC, datetime
    from io import BytesIO

    from PIL import Image

    from tassel.screen.session import ScreenFrame
    from tassel.voice.bot import _TurnContext

    context = _TurnContext()
    context.screen = ScreenSession()
    context.screen.control(source="display", epoch=1, active=True)
    jpeg = BytesIO()
    Image.new("RGB", (1600, 900), "white").save(jpeg, format="JPEG")

    async def frame():
        context.screen.put(
            ScreenFrame("current", "display", 1, 0, datetime.now(UTC), jpeg.getvalue())
        )

    context.request_frame = frame
    page = await context._turn_page()
    assert "1600x900" in page.caption
    assert "x=pixel_x/1600, y=pixel_y/900" in page.caption
    assert context.screen_frame_id == "current"
    await context.screen.reset(source="display", epoch=2, active=True)
    context.request_frame = None
    page = await context._turn_page()
    assert page.image is None
    assert context.screen_frame_id is None
