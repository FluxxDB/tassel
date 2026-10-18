"""Bounded model histories: what each model actually needs to see, so prompts stay small and
their static prefixes stay cacheable."""


def windowed(messages: list, keep: int) -> list:
    """The leading system messages, then the last `keep` conversation messages starting at a
    student message, with any app notes that fall inside that window."""
    head = 0
    while head < len(messages) and messages[head].get("role") == "system":
        head += 1
    body = messages[head:]
    seen = 0
    cut = 0
    for i in range(len(body) - 1, -1, -1):
        if body[i].get("role") != "system":
            seen += 1
            if seen > keep:
                cut = i + 1
                break
    if cut:
        # A trimmed window opens on a student message, never mid-exchange.
        while cut < len(body) and body[cut].get("role") != "user":
            cut += 1
    return messages[:head] + body[cut:]
