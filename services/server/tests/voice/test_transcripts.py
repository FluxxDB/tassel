import json
from uuid import uuid4

import pytest
from pipecat.frames.frames import LLMTextFrame, TranscriptionFrame, TTSAudioRawFrame, TTSTextFrame
from pipecat.observers.base_observer import FramePushed

from tassel.voice.transcripts import DevTranscript


@pytest.mark.asyncio
async def test_transcript_records_text_and_timings_without_images_or_keys(tmp_path):
    session = uuid4()
    log = DevTranscript(session, tmp_path, secrets=["private-key"])
    frames = [
        TranscriptionFrame("check this", "student", ""),
        LLMTextFrame("Hello"),
        TTSTextFrame("Hello private-key", "sentence"),
        TTSAudioRawFrame(b"pixels", 24000, 1),
    ]
    for frame in frames:
        await log.on_push_frame(
            FramePushed(
                source=None,
                destination=None,
                frame=frame,
                direction=None,
                timestamp=0,
                first_push=True,
            )
        )
    log.record("thinker_brief", {"say": "Hi", "image_url": "data:image/png;base64,AAAA"})
    log.record("tags", {"text": "[[circle m1]]"})
    log.record("reject", {"text": "bad tag"})
    log.record("thinker_duration", {"ms": 42})
    raw = (tmp_path / f"{session}.jsonl").read_text()
    rows = [json.loads(line) for line in raw.splitlines()]
    assert {r["event"] for r in rows} >= {
        "student_final",
        "ada_spoken",
        "first_token",
        "first_audio",
        "thinker_brief",
        "tags",
        "reject",
        "thinker_duration",
    }
    assert "private-key" not in raw and "AAAA" not in raw and "pixels" not in raw
    disabled = DevTranscript(uuid4(), None)
    disabled.record("tags", {"text": "nothing"})
    assert len(list(tmp_path.iterdir())) == 1
