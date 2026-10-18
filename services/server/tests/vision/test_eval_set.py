import json
from dataclasses import replace

import numpy as np
import pytest

from tassel.vision.evalset import SYNTHETIC_SET, gate_input_for, load_moments
from tassel.vision.page import decode_jpeg, encode_jpeg, flatten_page, resized
from tassel.vision.ports import PREDICATES


def test_moments_load_and_cover_each_predicate():
    moments = load_moments(SYNTHETIC_SET)
    assert len(moments) == len({m.id for m in moments}) == 24
    assert {m.variant for m in moments} == {
        "dfa-demo",
        "dfa-short",
        "shadow-pass",
        "hand-rests",
        "erase",
    }
    assert {m.lang for m in moments} == {"en", "es", "ko"}
    assert {p: sum(m.labels[p] is True for m in moments) for p in PREDICATES} == {
        "diagram_attempt_complete": 4,
        "new_work_worth_checking": 9,
        "student_seems_stuck": 4,
        "not_schoolwork": 4,
    }
    assert all(set(m.labels) == set(PREDICATES) and None not in m.labels.values() for m in moments)
    assert moments[17].transcript[-1].text == "다 했어요."
    assert moments[3].at_ms - moments[3].transcript[-1].at_ms == 9000
    assert moments[18].quiet_ms == 7500
    assert moments[22].changed_cells == 6
    assert [(moments[i].new_ink, moments[i].changed_cells) for i in (19, 20)] == [(False, 0)] * 2


def test_gate_input_for_uses_the_flat_page(tmp_path):
    # Nonuniform, synthetic RGB with a known central-crop fallback; never camera pixels.
    rgb = np.full((180, 320, 3), 70, dtype=np.uint8)
    rgb[60:110, 80:150] = [20, 35, 50]
    source = encode_jpeg(rgb)
    (tmp_path / "frames").mkdir()
    (tmp_path / "frames/1.jpg").write_bytes(source)
    moment = replace(load_moments(SYNTHETIC_SET)[3], variant="frames/1.jpg")
    gi = gate_input_for(moment, tmp_path)
    assert gi.quiet_ms == 7300 and gi.silence_ms == 9000
    assert gi.transcript == moment.transcript
    assert (gi.lang, gi.reason, gi.new_ink, gi.changed_cells) == ("en", "stall", False, 0)
    expected = encode_jpeg(resized(flatten_page(source, None).rgb, 1024))
    assert gi.image_jpeg == expected
    assert max(decode_jpeg(gi.image_jpeg).shape[:2]) == 1024


def test_gate_input_reads_synthetic_clip(clip):
    moment = load_moments(SYNTHETIC_SET)[18]
    made = clip("dfa-short")
    gi = gate_input_for(moment, made.mjpeg.parent)
    assert max(decode_jpeg(gi.image_jpeg).shape[:2]) == 1024


@pytest.mark.parametrize("variant", ["../outside.jpg", "/tmp/outside.jpg", "frames/link.jpg"])
def test_frame_paths_cannot_escape_dataset(tmp_path, variant):
    (tmp_path / "frames").mkdir()
    (tmp_path / "frames/link.jpg").symlink_to(tmp_path.parent / "outside.jpg")
    with pytest.raises(ValueError):
        gate_input_for(replace(load_moments(SYNTHETIC_SET)[0], variant=variant), tmp_path)


@pytest.mark.parametrize("change", ["duplicate", "missing-label", "bad-label", "negative-time"])
def test_load_moments_rejects_invalid_sets(tmp_path, change):
    body = json.loads(SYNTHETIC_SET.read_text())
    if change == "duplicate":
        body["moments"].append(body["moments"][0])
    elif change == "missing-label":
        del body["moments"][0]["labels"]["not_schoolwork"]
    elif change == "bad-label":
        body["moments"][0]["labels"]["not_schoolwork"] = "false"
    else:
        body["moments"][0]["at_ms"] = -1
    path = tmp_path / "labels.json"
    path.write_text(json.dumps(body))
    with pytest.raises(ValueError):
        load_moments(path)
