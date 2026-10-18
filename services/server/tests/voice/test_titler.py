"""Automatic session names: the namer's policy with a fake titler, the live titler's parsing with
a fake client, the repository's AI naming, and the bot emitting a title on the fake pipeline."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from test_bot_pipeline import SCRIPT, context, running, say, until

from tassel.models import SessionCreate, SessionPatch
from tassel.storage import sessions_repo
from tassel.storage.db import make_engine, session_factory
from tassel.storage.tables import Learner
from tassel.voice.settings import VoiceSettings
from tassel.voice.titler import FakeTitler, LiveTitler, Namer, SessionName

pytestmark = pytest.mark.asyncio


class RecordingTitler:
    """Answers each call from a queue and records what it was asked."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    async def name(self, exchanges, *, lang, current):
        self.calls.append((list(exchanges), lang, current))
        return self.answers.pop(0) if self.answers else None


def namer(titler, **kwargs):
    saved, emitted = [], []

    async def save(name):
        saved.append(name)
        return True

    async def emit(name):
        emitted.append(name)

    defaults = {"lang": lambda: "en", "save": save, "emit": emit}
    return Namer(titler, **{**defaults, **kwargs}), saved, emitted


async def test_names_after_the_first_substantive_exchange_not_a_greeting():
    titler = RecordingTitler(
        [SessionName(title="DFA for strings starting 010", subject="Automata")]
    )
    n, saved, emitted = namer(titler)
    await n.exchange("Hi Ada", "Hi! What are we working on?")
    assert titler.calls == [] and saved == [] and emitted == []
    await n.exchange(
        "Can you draw a DFA for binary strings that start with 010?", "Sure, here it is."
    )
    assert len(titler.calls) == 1
    assert titler.calls[0][1] == "en" and titler.calls[0][2] is None
    assert (
        saved == emitted == [SessionName(title="DFA for strings starting 010", subject="Automata")]
    )


async def test_never_names_a_session_the_student_named():
    titler = RecordingTitler([SessionName(title="x", subject=None)])
    n, saved, emitted = namer(
        titler, current=SessionName(title="My own name", subject=None), source="student"
    )
    await n.exchange("Can you draw a DFA for binary strings that start with 010?", "Sure.")
    assert titler.calls == [] and saved == [] and emitted == []


async def test_renames_once_only_on_a_clear_topic_change():
    first = SessionName(title="DFA for strings starting 010", subject="Automata")
    n, saved, emitted = namer(
        RecordingTitler(
            [
                SessionName(title="Subnetting 192.168.1.0/24", subject="Networking"),
                SessionName(title="Derivatives of polynomials", subject="Calculus"),
            ]
        ),
        current=first,
        source="ai",
    )
    titler = n.titler
    # The same topic in her own words: no call at all.
    await n.exchange("Can you trace 0101 on the DFA step by step?", "Let's trace it.")
    assert titler.calls == []
    # A different subject: one call with the current name, and a rename.
    await n.exchange("Now help me subnet 192.168.1.0/24 into four networks", "Let's subnet.")
    assert len(titler.calls) == 1 and titler.calls[0][2] == first
    assert (
        saved == emitted == [SessionName(title="Subnetting 192.168.1.0/24", subject="Networking")]
    )
    # A second change never renames again.
    await n.exchange("Actually, what's the derivative of x squared?", "2x.")
    assert len(titler.calls) == 1 and len(saved) == 1


async def test_keeps_the_name_when_the_titler_says_same_or_fails():
    first = SessionName(title="DFA for strings starting 010", subject="Automata")
    n, saved, emitted = namer(RecordingTitler([None, None]), current=first, source="ai")
    await n.exchange("What about the Pumping Lemma for regular languages?", "Good question.")
    assert saved == [] and emitted == [] and n.current == first


async def test_live_titler_parses_json_and_enforces_word_limits():
    requests = []

    async def create(**kwargs):
        requests.append(kwargs)
        content = json.dumps(
            {
                "title": '"Building a DFA for strings that start with 010."',
                "subject": "Automata Theory And Formal Languages",
            }
        )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
            usage=SimpleNamespace(prompt_tokens=120, completion_tokens=20),
        )

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    usage = []
    titler = LiveTitler(
        VoiceSettings(providers="fake"),
        client=client,
        on_usage=lambda model, **u: usage.append((model, u)),
    )
    name = await titler.name(
        [("Can you draw a DFA for strings that start with 010?", "Sure.")], lang="ko", current=None
    )
    assert name == SessionName(
        title="Building a DFA for strings that", subject="Automata Theory And"
    )
    assert "Korean" in requests[0]["messages"][0]["content"]
    assert usage and usage[0][1]["prompt"] == 120
    # Qwen answers in JSON with reasoning off (live run 2026-10-18: it thought away its tokens).
    assert requests[0]["response_format"] == {"type": "json_object"}
    assert requests[0]["extra_body"]["reasoning"] == {"enabled": False}


async def test_live_titler_same_and_null_mean_no_name():
    async def create(**kwargs):
        content = '{"same": true}' if "currently" in kwargs["messages"][0]["content"] else "{}"
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))], usage=None
        )

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    titler = LiveTitler(VoiceSettings(providers="fake"), client=client)
    assert (
        await titler.name([("Hello there, how are you?", "Fine.")], lang="en", current=None) is None
    )
    current = SessionName(title="DFAs", subject=None)
    assert await titler.name([("more DFAs", "ok")], lang="en", current=current) is None


async def test_fake_titler_names_from_the_scenario_or_her_words():
    assert await FakeTitler("Strings that start with 010").name(
        [("anything", "x")], lang="en", current=None
    ) == SessionName(title="Strings that start with 010", subject=None)
    name = await FakeTitler(None).name(
        [("can you help me subnet this network into four pieces", "x")], lang="en", current=None
    )
    assert name is not None and len(name.title.split()) <= 6
    assert name.subject is not None and len(name.subject.split()) <= 3


async def test_ai_name_keeps_activity_and_never_overwrites_the_student(db_url):
    engine = make_engine(db_url)
    sessions = session_factory(engine)
    try:
        async with sessions() as db:
            learner = Learner()
            db.add(learner)
            await db.commit()
            row = await sessions_repo.create(
                db, learner.id, SessionCreate(type="studying", source="talk", language="en")
            )
            created = row.last_activity_at
            named = await sessions_repo.name_by_ai(db, learner.id, row.id, "DFA basics", "Automata")
            assert (named.title, named.subject, named.title_source) == (
                "DFA basics",
                "Automata",
                "ai",
            )
            assert named.last_activity_at == created
            # Her own rename wins, keeps its order in Recent, and the titler can't undo it.
            mine = await sessions_repo.patch_for(
                db, learner.id, row.id, SessionPatch(title="My DFA homework")
            )
            assert mine.title_source == "student" and mine.last_activity_at == created
            assert await sessions_repo.name_by_ai(db, learner.id, row.id, "Other", None) is None
            again = await sessions_repo.get_for(db, learner.id, row.id)
            assert again.title == "My DFA homework"
            # A language change is activity.
            moved = await sessions_repo.patch_for(
                db, learner.id, row.id, SessionPatch(language="ko")
            )
            assert moved.last_activity_at > created
    finally:
        await engine.dispose()


async def test_bot_titles_the_session_after_the_first_exchange(db_url):
    engine = make_engine(db_url)
    sessions = session_factory(engine)
    try:
        async with sessions() as db:
            learner = Learner()
            db.add(learner)
            await db.commit()
            row = await sessions_repo.create(
                db, learner.id, SessionCreate(type="studying", source="talk", language="en")
            )
            ctx = context(learner_id=learner.id, session_id=row.id, sessions=sessions)
        async with running(ctx) as (bot, out):
            await until(lambda: SCRIPT.langs["en"].greeting in out.text())
            assert not any(e["kind"] == "title" for e in out.events())
            await say(bot, "I'm working on a DFA for strings that start with 010")
            await until(lambda: SCRIPT.langs["en"].turns[0].say in out.text())
            await until(lambda: any(e["kind"] == "title" for e in out.events()))
            title = next(e for e in out.events() if e["kind"] == "title")
            assert title["title"] == SCRIPT.title
            async with sessions() as db:
                saved = await sessions_repo.get_for(db, ctx.learner_id, ctx.session_id)
                await until(lambda: True)
                assert saved.title == SCRIPT.title and saved.title_source == "ai"
                assert saved.last_activity_at == row.last_activity_at
    finally:
        await engine.dispose()


async def test_bot_leaves_the_students_own_title_alone():
    ctx = context(title="Mine", title_source="student", titled=True)
    async with running(ctx) as (bot, out):
        await until(lambda: SCRIPT.langs["en"].greeting in out.text())
        await say(bot, "I'm working on a DFA for strings that start with 010")
        await until(lambda: SCRIPT.langs["en"].turns[0].say in out.text())
        await asyncio.sleep(0.05)
        assert not any(e["kind"] == "title" for e in out.events())
