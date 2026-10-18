"""Authored tutor style is isolated from automatic memory and reaches both response paths."""

import pytest

from tassel.voice.prompts import system_prompt, thinker_system_prompt


async def auth(client):
    token = (await client.post("/v1/devices")).json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_personality_is_private_persistent_bounded_and_independent(client):
    owner, other = await auth(client), await auth(client)
    endpoint = "/v1/learner/personalization"
    assert (await client.get(endpoint)).status_code == 401
    assert (await client.get(endpoint, headers=owner)).json() == dict(
        enabled=True, content="", revision=0
    )
    result = await client.patch(
        endpoint,
        headers=owner,
        json=dict(
            enabled=True,
            content="  Be calm and casual.  ",
            revision=0,
        ),
    )
    assert result.status_code == 200
    assert result.json() == dict(enabled=True, content="Be calm and casual.", revision=1)
    assert (await client.get(endpoint, headers=other)).json()["content"] == ""
    assert (
        await client.patch(
            endpoint,
            headers=owner,
            json=dict(
                enabled=True,
                content="stale",
                revision=0,
            ),
        )
    ).status_code == 409
    assert (
        await client.patch(
            endpoint,
            headers=owner,
            json=dict(
                enabled=True,
                content="x" * 2001,
                revision=1,
            ),
        )
    ).status_code == 422
    await client.patch(
        "/v1/learner/memory", headers=owner, json=dict(enabled=False, content="", revision=0)
    )
    assert (await client.get(endpoint, headers=owner)).json()["content"] == "Be calm and casual."
    result = await client.patch(
        endpoint,
        headers=owner,
        json=dict(
            enabled=False,
            content="Be calm and casual.",
            revision=1,
        ),
    )
    assert result.status_code == 200
    assert result.json()["content"] == "Be calm and casual."


def test_style_replaces_default_delivery_without_changing_routing_or_language():
    prompt = system_prompt(
        "es", tools=False, two_tier=True, ideal_tutor="Be lively and use gentle humor."
    )
    assert "Be lively and use gentle humor." in prompt
    assert "Reply only in Spanish" in prompt
    assert "warm, patient and Socratic" not in prompt
    assert "one or two short sentences per turn" not in prompt
    assert "Call show_stage" not in prompt
    assert "[[dfa ITEM" not in prompt
    assert "Never give the full solution unless the student asks" in prompt
    thinker = thinker_system_prompt({}, ideal_tutor="Be lively and use gentle humor.")
    assert "Be lively and use gentle humor." in thinker
    assert "guidance brief" in thinker and "JSON" in thinker


def test_empty_style_preserves_the_default_prompt():
    assert system_prompt("en", ideal_tutor="") == system_prompt("en")
    assert "warm, patient and Socratic" in system_prompt("en")


@pytest.mark.asyncio
async def test_disabled_memory_and_disabled_style_are_independent_in_prompts(client, app):
    from sqlalchemy import select

    from tassel.auth import hash_token
    from tassel.learner_personalization import read_tutor_preferences
    from tassel.storage.tables import Device

    headers = await auth(client)
    await client.patch(
        "/v1/learner/personalization",
        headers=headers,
        json=dict(
            enabled=True,
            content="Be calm and informal.",
            revision=0,
        ),
    )
    await client.patch(
        "/v1/learner/memory",
        headers=headers,
        json=dict(
            enabled=False,
            content="Likes one hint at a time.",
            revision=0,
        ),
    )
    # Obtain the learner through its authenticated device without hardcoding IDs.
    async with app.state.session_factory() as db:
        device = await db.scalar(
            select(Device).where(Device.token_hash == hash_token(headers["Authorization"][7:]))
        )
        preferences = await read_tutor_preferences(db, device.learner_id)
    prompt = preferences.talker_prompt("en", tools=False, two_tier=True)
    assert "Be calm and informal." in prompt
    assert "Likes one hint at a time." not in prompt
    await client.patch(
        "/v1/learner/personalization",
        headers=headers,
        json=dict(
            enabled=False,
            content="Be calm and informal.",
            revision=1,
        ),
    )
    await client.patch(
        "/v1/learner/memory",
        headers=headers,
        json=dict(
            enabled=True,
            content="Likes one hint at a time.",
            revision=1,
        ),
    )
    async with app.state.session_factory() as db:
        preferences = await read_tutor_preferences(db, device.learner_id)
    prompt = preferences.talker_prompt("ko", tools=False, two_tier=True)
    assert "Be calm and informal." not in prompt
    assert "Likes one hint at a time." in prompt
    assert "Reply only in Korean" in prompt
    assert "Call show_stage" not in prompt


@pytest.mark.asyncio
async def test_thinker_requests_use_current_style_and_drop_disabled_style():
    from types import SimpleNamespace

    from tassel.voice.settings import VoiceSettings
    from tassel.voice.thinker import Thinker

    calls = []

    async def complete(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="""{
            "page":"", "intent":"explain", "diagnosis":"", "plan":["Explain"],
            "say":"Let's try one step.", "board":[], "paper":[], "confidence":1,
            "followups":[]
        }"""
                    )
                )
            ]
        )

    thinker = Thinker(
        VoiceSettings(),
        client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=complete))),
    )
    thinker.ideal_tutor = "Be playful and energetic."
    await thinker.think([{"role": "user", "content": "Explain this."}])
    assert "Be playful and energetic." in calls[0]["messages"][0]["content"]
    thinker.ideal_tutor = ""
    await thinker.think([{"role": "user", "content": "Explain this again."}])
    assert "Be playful and energetic." not in calls[1]["messages"][0]["content"]


@pytest.mark.parametrize("board_present", [False, True])
def test_legacy_memory_migration_marker_is_reconciled_without_losing_notes(board_present):
    from sqlalchemy import create_engine, text

    from tassel.storage.migration_compat import reconcile_legacy_memory_revision

    engine = create_engine("sqlite://")
    with engine.connect() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num TEXT)"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('0004')"))
        connection.execute(
            text(
                "CREATE TABLE sessions (id TEXT"
                + (", board_actions TEXT" if board_present else "")
                + ")"
            )
        )
        connection.execute(text("CREATE TABLE learner_memory (content TEXT)"))
        connection.execute(text("INSERT INTO learner_memory VALUES ('Keep my notes')"))
        connection.execute(text("CREATE TABLE memory_extractions (digest TEXT)"))
        connection.commit()
        reconcile_legacy_memory_revision(connection)
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == (
            "0004" if board_present else "learner_memory_01"
        )
        assert connection.scalar(text("SELECT content FROM learner_memory")) == "Keep my notes"
    engine.dispose()


@pytest.mark.asyncio
async def test_bot_refreshes_both_personalities_and_preserves_routes_on_language_change(
    client, app, monkeypatch, tmp_path
):
    from unittest.mock import AsyncMock
    from uuid import uuid4

    from pipecat.processors.frame_processor import FrameProcessor
    from sqlalchemy import select

    from tassel.auth import hash_token
    from tassel.storage.tables import Device
    from tassel.voice.bot import BotContext, build_bot
    from tassel.voice.director import Director
    from tassel.voice.memory import ConversationMemory
    from tassel.voice.messages import OfferRequestData
    from tassel.voice.settings import VoiceSettings

    headers = await auth(client)
    async with app.state.session_factory() as db:
        device = await db.scalar(
            select(Device).where(Device.token_hash == hash_token(headers["Authorization"][7:]))
        )
    await client.patch(
        "/v1/learner/personalization",
        headers=headers,
        json=dict(
            enabled=True,
            content="Be calm and informal.",
            revision=0,
        ),
    )
    monkeypatch.setattr(
        "tassel.voice.bot.make_director", lambda *args, **kwargs: Director(client=None)
    )
    settings = VoiceSettings(
        providers="auto",
        llm_provider="openai",
        stt_provider="fake",
        tts_provider="fake",
        titles_provider="fake",
        openai_api_key="test-only",
        openrouter_api_key="test-only",
        openai_model="gpt-6-astra",
        transcript_dir=tmp_path,
        fake_tts="tone",
    )
    ctx = BotContext(
        learner_id=device.learner_id,
        session_id=uuid4(),
        lang="en",
        titled=True,
        request=OfferRequestData(),
        settings=settings,
        memory=ConversationMemory(),
        sessions=app.state.session_factory,
    )
    bot = build_bot(FrameProcessor(), FrameProcessor(), ctx)
    pushed = AsyncMock()
    monkeypatch.setattr(bot._turn_context, "push_frame", pushed)
    monkeypatch.setattr(bot.llm, "queue_frame", AsyncMock())
    try:
        await bot._turn_context.refresh_memory()
        prompt = pushed.call_args.args[0].delta.system_instruction
        assert "Be calm and informal." in prompt
        assert "Call show_stage" not in prompt and "[[dfa ITEM" not in prompt
        thinker = bot._turn_context.coordinator.thinker
        assert thinker.ideal_tutor == "Be calm and informal."
        # Refreshing a resumed session in another language reuses exactly the same preferences.
        ctx.lang = "es"
        await bot._turn_context.refresh_memory()
        assert "Reply only in Spanish" in pushed.call_args.args[0].delta.system_instruction
        assert "Be calm and informal." in pushed.call_args.args[0].delta.system_instruction
        await client.patch(
            "/v1/learner/personalization",
            headers=headers,
            json=dict(
                enabled=False,
                content="Be calm and informal.",
                revision=1,
            ),
        )
        await bot._turn_context.refresh_memory()
        assert "Be calm and informal." not in pushed.call_args.args[0].delta.system_instruction
        assert thinker.ideal_tutor == ""
    finally:
        await bot.llm.cleanup()
        await bot._turn_context.coordinator.close()
