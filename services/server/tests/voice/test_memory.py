from uuid import uuid4

from tassel.voice.memory import ConversationMemory


def test_unknown_expiry_and_language():
    now = [10.0]
    memory = ConversationMemory(ttl_s=30, clock=lambda: now[0])
    key = uuid4()
    assert memory.recall(key) == ([], None)
    messages = [{"role": "user", "content": "Hi"}]
    memory.remember(key, messages, "ko")
    assert memory.recall(key) == (messages, "ko")
    now[0] = 40
    assert memory.recall(key) == ([], None)


def test_strip_system_cap_and_cut_after_tool_pair():
    key = uuid4()
    memory = ConversationMemory()
    messages = [{"role": "user" if i % 2 else "assistant", "content": str(i)} for i in range(45)]
    messages[5] = {"role": "assistant", "content": None, "tool_calls": [{"id": "x"}]}
    messages[6] = {"role": "tool", "content": "ok", "tool_call_id": "x"}
    memory.remember(key, [{"role": "system", "content": "Ada"}, *messages], "en")
    saved, lang = memory.recall(key)
    assert saved == messages[7:]
    assert len(saved) <= 40
    assert lang == "en"
    saved[0]["content"] = "mutated"
    assert memory.recall(key)[0][0]["content"] == "7"


def test_greeting_only_survives_resume():
    memory = ConversationMemory()
    key = uuid4()
    greeting = [{"role": "assistant", "content": "Hello"}]
    memory.remember(key, greeting, "en")
    assert memory.recall(key)[0] == greeting
