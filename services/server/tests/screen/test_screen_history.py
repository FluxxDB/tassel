from tassel.screen.history import retire_screen_tools


def test_earlier_screen_tool_calls_and_results_leave_the_context():
    messages = [
        {"role": "system", "content": "You are Ada."},
        {"role": "user", "content": "Find the Roblox game Hypershot on my screen"},
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "draw_screen",
                        "arguments": '{"frame_id":"old","kind":"circle","target":"Hypershot"}',
                    },
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call-1", "content": '{"ok": false, "reason": "absent"}'},
        {"role": "assistant", "content": "I can't see Hypershot on this screen."},
        {
            "role": "assistant",
            "content": "Let me switch.",
            "tool_calls": [
                {
                    "id": "call-2",
                    "type": "function",
                    "function": {"name": "set_language", "arguments": '{"language":"es"}'},
                },
                {
                    "id": "call-3",
                    "type": "function",
                    "function": {"name": "edit_screen", "arguments": '{"operation":"list"}'},
                },
            ],
        },
        {"role": "tool", "tool_call_id": "call-2", "content": '{"ok": true}'},
        {"role": "tool", "tool_call_id": "call-3", "content": '{"ok": true, "objects": []}'},
        {"role": "user", "content": "Explain the next question"},
    ]
    assert retire_screen_tools(messages) == 2
    assert [m["role"] for m in messages] == [
        "system",
        "user",
        "assistant",
        "assistant",
        "tool",
        "user",
    ]
    assert messages[2]["content"] == "I can't see Hypershot on this screen."
    assert [c["id"] for c in messages[3]["tool_calls"]] == ["call-2"]
    assert messages[4]["tool_call_id"] == "call-2"
    assert "draw_screen" not in str(messages) and "call-1" not in str(messages)


def test_nothing_to_retire_leaves_the_context_alone():
    messages = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "Hello"}]
    before = [dict(m) for m in messages]
    assert retire_screen_tools(messages) == 0
    assert messages == before
