"""Registry lifecycle, shared CPU budget and safe diagnostic records."""

import asyncio
import json
from uuid import uuid4

import pytest

from tassel.storage.db import make_engine, session_factory
from tassel.vision.log import VisionLog
from tassel.vision.registry import VisionRegistry
from tassel.vision.settings import VisionSettings


@pytest.mark.asyncio
async def test_sessions_share_limiter_and_idle_sessions_are_removed(db_url):
    engine = make_engine(db_url)
    now = [100.0]
    registry = VisionRegistry(
        settings=VisionSettings(), sessions=session_factory(engine), clock=lambda: now[0]
    )
    try:
        learner = uuid4()
        a = registry.session(learner_id=learner, session_id=uuid4(), lang="en")
        b = registry.session(learner_id=learner, session_id=uuid4(), lang="ko")
        assert a.limiter is b.limiter and a.limiter.total_tokens == 2
        assert registry.get(a.session_id) is a
        assert registry.session(learner_id=learner, session_id=a.session_id, lang="en") is a
        now[0] += 1801
        await asyncio.sleep(0.3)
        assert registry.get(a.session_id) is None and registry.get(b.session_id) is None
    finally:
        await registry.shutdown()
        await engine.dispose()


def test_vision_log_writes_json_lines_without_images_or_keys(tmp_path):
    path = tmp_path / "nested" / "vision.jsonl"
    log = VisionLog(path)
    sid = uuid4()
    log.write(
        sid,
        {
            "stage": "gate",
            "reason": "frame",
            "provider": "fake",
            "ms": 1,
            "image_jpeg": b"private pixels",
            "api_key": "private key",
        },
    )
    result = json.loads(path.read_text())
    assert result["session_id"] == str(sid) and result["reason"] == "frame"
    assert "private" not in path.read_text()
    VisionLog(None).write(sid, {"stage": "gate"})
