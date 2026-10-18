"""Ada's tags on the student's image: [[image show]], [[image clear]] and [[image VERB TARGET]],
on the image on stage (the latest she sent), beside the paper tags, which stay as they were."""

import pytest

from tassel.beats.markup import BoardContext, MarkupStream, StageImage, parse_command
from tassel.beats.models import BEAT_ACTION, DetectedElements

IMAGE_ID = "5f0e7a52-37d0-4a8c-9a8e-2b1c6f1d9e01"


def ctx(**changes) -> BoardContext:
    detected = DetectedElements(
        width=1000,
        height=800,
        items=[
            {"id": "m1", "kind": "label", "box": {"x": 60, "y": 40, "w": 400, "h": 40}},
            {"id": "m2", "kind": "label", "box": {"x": 60, "y": 110, "w": 520, "h": 30}},
            {"id": "m3", "kind": "label", "box": {"x": 130, "y": 530, "w": 440, "h": 230}},
        ],
    )
    return BoardContext(image=StageImage(IMAGE_ID, detected), **changes)


def dump(action) -> dict:
    return BEAT_ACTION.dump_python(action, mode="json", by_alias=True)


def test_show_and_clear_name_the_image_on_stage():
    board = ctx()
    assert dump(parse_command("image show", board)) == {
        "kind": "image.show",
        "attachmentId": IMAGE_ID,
    }
    assert dump(parse_command("image clear", board)) == {
        "kind": "image.clear",
        "attachmentId": IMAGE_ID,
    }


@pytest.mark.parametrize(
    ("command", "mark"),
    [
        ("image circle m3", {"type": "circle", "target": {"el": "m3"}}),
        ("image wash m3", {"type": "circle", "target": {"el": "m3"}, "wash": True}),
        ("image underline m2", {"type": "underline", "target": {"el": "m2"}}),
        ("image strike m1", {"type": "strike", "target": {"el": "m1"}}),
        ("image check m2", {"type": "check", "target": {"el": "m2"}}),
        ("image number 2 m2", {"type": "step", "n": 2, "target": {"el": "m2"}}),
        (
            'image callout m1 "Read the title again"',
            {"type": "callout", "target": {"el": "m1"}, "text": "Read the title again"},
        ),
        (
            "image circle box=0.1,0.2,0.3,0.1",
            {"type": "circle", "target": {"box": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}}},
        ),
    ],
)
def test_a_mark_on_the_image_is_an_image_mark_with_the_paper_marks_shape(command, mark):
    board = ctx()
    action = dump(parse_command(command, board))
    assert action["kind"] == "image.mark"
    assert action["attachmentId"] == IMAGE_ID
    assert action["mark"] == {"id": "m1", **mark}
    # Marks share the paper's counter, so every mark id in the session is its own.
    assert board.next_mark == 2


@pytest.mark.parametrize(
    "command",
    [
        "image",
        "image show m3",
        "image circle",
        "image circle q0",
        "image circle q0>q1",
        "image number two m2",
        "image callout m1",
        "image freeze",
        "image circle box=0.9,0.9,0.5,0.5",
    ],
)
def test_a_bad_image_command_is_refused(command):
    board = ctx()
    assert parse_command(command, board) is None
    assert board.next_mark == 1


def test_with_no_image_on_stage_every_image_tag_is_refused():
    board = BoardContext()
    for command in ("image show", "image clear", "image circle m1"):
        assert parse_command(command, board) is None


def test_paper_tags_are_unchanged_beside_image_tags():
    board = ctx()
    stream = MarkupStream(board)
    sentences = stream.feed("[[image circle m3]]This one. [[circle q0]]And q0 on paper.")
    sentences += stream.flush()
    actions = [dump(a) for s in sentences for _, a in s.anchors]
    assert [a["kind"] for a in actions] == ["image.mark", "paper.mark"]
    assert actions[1]["mark"] == {"id": "m2", "type": "circle", "target": {"el": "state:q0"}}
    assert [s.problems for s in sentences] == [[], []]


def test_an_image_tag_without_an_image_is_a_named_problem():
    stream = MarkupStream(BoardContext())
    [sentence] = stream.feed("[[image circle m3]]Look here.") + stream.flush()
    assert sentence.anchors == []
    assert sentence.clean == "Look here."
    assert sentence.problems and "no student image" in sentence.problems[0]
