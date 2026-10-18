"""What an earlier screen turn leaves in the talker's context once a new turn begins."""

SCREEN_TOOL_NAMES = frozenset(
    {"draw_screen", "draw_screen_illustration", "draw_screen_board", "edit_screen"}
)


def _has_text(message: dict) -> bool:
    content = message.get("content")
    if isinstance(content, str):
        return bool(content.strip())
    if isinstance(content, list):
        return any(
            isinstance(block, dict) and str(block.get("text", "")).strip() for block in content
        )
    return False


def retire_screen_tools(messages: list[dict]) -> int:
    """Drops earlier turns' screen tool calls and their results, in place; her words and the
    tutor's spoken lines stay.

    Their frame ids are stale, and a failed attempt left there ("find the Roblox game
    Hypershot": absent) is what the tutor replayed on an unrelated later turn, once a new
    frame arrived. Returns how many calls were retired.
    """
    retired: set[str] = set()
    for message in messages:
        calls = message.get("tool_calls")
        if message.get("role") != "assistant" or not isinstance(calls, list):
            continue
        kept = []
        for call in calls:
            function = call.get("function") if isinstance(call, dict) else None
            if isinstance(function, dict) and function.get("name") in SCREEN_TOOL_NAMES:
                retired.add(str(call.get("id")))
            else:
                kept.append(call)
        if kept:
            message["tool_calls"] = kept
        else:
            del message["tool_calls"]
    if not retired:
        return 0
    messages[:] = [
        m
        for m in messages
        if not (m.get("role") == "tool" and str(m.get("tool_call_id")) in retired)
        and not (m.get("role") == "assistant" and "tool_calls" not in m and not _has_text(m))
    ]
    return len(retired)
