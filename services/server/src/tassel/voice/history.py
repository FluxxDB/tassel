"""Bounded model histories: what each model actually needs to see, so prompts stay small and
their static prefixes stay cacheable."""


def windowed(messages: list, keep: int, *, step: int = 1) -> list:
    """The leading system messages, then at most the last `keep` conversation messages starting
    at a student message, with any app notes that fall inside that window. `step`: older messages
    go in blocks of that many, so the window's start (and the provider's cached prefix) holds for
    several turns; the window keeps between `keep - step` and `keep` of them."""
    head = 0
    while head < len(messages) and messages[head].get("role") == "system":
        head += 1
    body = messages[head:]
    talk = [i for i, m in enumerate(body) if m.get("role") != "system"]
    over = len(talk) - keep
    cut = 0
    if over > 0:
        drop = min(-(-over // step) * step, len(talk))
        cut = talk[drop - 1] + 1
    if cut:
        # A trimmed window opens on a student message, never mid-exchange.
        while cut < len(body) and body[cut].get("role") != "user":
            cut += 1
    return messages[:head] + body[cut:]
