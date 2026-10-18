"""The chat log's lines, in the order the app sees them, and which of them are saved."""

import asyncio

import pytest

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.chat.log import ChatLog
from tassel.voice.messages import MessageAttachment, StageEvent

pytestmark = pytest.mark.asyncio


class Sink:
    def __init__(self):
        self.sent, self.saved = [], []

    async def send(self, message):
        self.sent.append(message)

    async def save(self, seq, message):
        self.saved.append((seq, message))


def log(**kwargs):
    sink = Sink()
    return ChatLog(sink.send, save=sink.save, **kwargs), sink


def sentence(text, board=None):
    stream = MarkupStream(board or BoardContext())
    (one,) = stream.feed(text) + stream.flush()
    return one


def shape(messages):
    return [
        (m.role, m.source, m.text, m.final, m.interrupted, m.action and m.action.kind)
        for m in messages
    ]


async def test_a_spoken_turn_then_her_reply_growing_in_step_then_final():
    chat, sink = log()
    await chat.student("Can you draw a DFA?", source="voice")
    await chat.heard("We start at q0.", 1)
    await chat.heard("A 0 takes us to q1.", 2)
    await chat.ended()
    await chat.close()
    assert shape(sink.sent) == [
        ("student", "voice", "Can you draw a DFA?", True, False, None),
        ("tutor", "voice", "We start at q0.", False, False, None),
        ("tutor", "voice", "We start at q0. A 0 takes us to q1.", False, False, None),
        ("tutor", "voice", "We start at q0. A 0 takes us to q1.", True, False, None),
    ]
    tutor = sink.sent[1:]
    assert len({m.id for m in tutor}) == 1
    # Only finals are saved, each at its place.
    assert [(seq, m.role) for seq, m in sink.saved] == [(1, "student"), (2, "tutor")]


async def test_a_typed_turn_echoes_its_client_id_and_her_answer_is_typed():
    chat, sink = log(first_seq=7)
    image = MessageAttachment(id="a-1", w=640, h=480)
    await chat.student("Here's part b", source="typed", client_id="c-1", attachments=[image])
    await chat.heard("Part b wants strings ending in 10.", 5)
    await chat.ended()
    await chat.close()
    student, *_, reply = sink.sent
    assert student.client_id == "c-1" and student.attachments == [image]
    assert reply.source == "typed" and reply.final
    assert [seq for seq, _ in sink.saved] == [8, 9]
    # The next spoken line, and her answer to it, are voice again.
    await chat.student("Thanks", source="voice")
    await chat.heard("You're welcome.")
    assert sink.sent[-1].source == "voice"


async def test_an_interrupted_reply_ends_where_she_stopped():
    chat, sink = log()
    board = BoardContext()
    await chat.heard("We start at q0,", 1)
    # This sentence draws, but she's cut off before it's heard: no row for it.
    await chat.sentence(sentence("and here is the machine. [[dfa m start=q0 q0-0-q1]]", board), 2)
    await chat.interrupted()
    await chat.interrupted()  # The interruption's other copy changes nothing.
    await chat.close()
    assert shape(sink.sent) == [
        ("tutor", "voice", "We start at q0,", False, False, None),
        ("tutor", "voice", "We start at q0,", True, True, None),
    ]
    assert [m.interrupted for _, m in sink.saved] == [True]


async def test_action_rows_follow_the_words_that_carry_them():
    chat, sink = log()
    await chat.sentence(sentence("Here is the machine. [[dfa m start=q0 q0-0-q1]]"), 1)
    assert sink.sent == []
    await chat.heard("Here is the machine.", 1)
    # A wordless beat fires as the app loads it: its row shows at once.
    await chat.sentence(sentence("[[clear m]]"), None)
    await chat.ended()
    await chat.close()
    assert shape(sink.sent) == [
        ("tutor", "voice", "Here is the machine.", False, False, None),
        ("action", None, "", True, False, "draw"),
        ("action", None, "", True, False, "clear"),
        ("tutor", "voice", "Here is the machine.", True, False, None),
    ]
    assert sink.sent[1].action.item == "m"
    # Seq follows first appearance: the line, then its rows.
    assert sorted((seq, m.role) for seq, m in sink.saved) == [
        (1, "tutor"),
        (2, "action"),
        (3, "action"),
    ]


async def test_a_view_row_only_when_the_view_changes():
    chat, sink = log()
    chat.app_view("paper")
    await chat.server_event(StageEvent(view="paper", pinned=True))
    await chat.server_event(StageEvent(view="split"))
    await chat.server_event(StageEvent(view="board"))
    await chat.server_event(StageEvent(view="paper"))
    assert [(m.action.kind, m.action.side) for m in sink.sent] == [
        ("view", "board"),
        ("view", "paper"),
    ]


async def test_showing_her_image_is_a_view_row_once_per_image():
    from tassel.beats.markup import StageImage

    chat, sink = log()
    chat.app_view("paper")
    board = BoardContext(image=StageImage("a-1"))
    await chat.sentence(sentence("[[image show]]Here.", board), None)
    await chat.sentence(sentence("[[image show]]Still here.", board), None)
    board.image = StageImage("a-2")
    await chat.sentence(sentence("[[image show]]And this one.", board), None)
    await chat.server_event(StageEvent(view="paper"))
    assert [(m.action.kind, m.action.side, m.action.attachment_id) for m in sink.sent] == [
        ("view", "image", "a-1"),
        ("view", "image", "a-2"),
        ("view", "paper", None),
    ]


async def test_a_failing_save_or_send_never_raises():
    async def broken(*args):
        raise RuntimeError("database down")

    chat = ChatLog(broken, save=broken)
    await chat.student("Hi", source="voice")
    await chat.heard("Hello.")
    await chat.ended()
    await chat.close()


async def test_close_waits_for_slow_saves():
    saved = []

    async def slow(seq, message):
        await asyncio.sleep(0.05)
        saved.append(seq)

    async def send(message):
        pass

    chat = ChatLog(send, save=slow)
    await chat.student("Hi", source="voice")
    await chat.close()
    assert saved == [1]
