"""Erasing is honest (real-token eval, clear-one): "Please erase the network diagram but keep the
DFA" came back with no [[clear]] tag at all, and Ada said "The network is erased; the DFA stays."
An erase turn whose brief takes nothing off the board picks the item from her words against the
board's items; when her words fit no single item, Ada says she couldn't tell, never that it's
gone."""

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_honest_actions import DRAW, Thinker, spoken
from test_two_tier import brief

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.beats.models import DiagramSpec
from tassel.voice.erase import ASK_ALL, CONFIRM, COULD_NOT_ERASE, pick, pick_rename, share
from tassel.voice.thinker import TutorCoordinator

DFA = "[[dfa starts010 start=q0 accept=q3 q0-0-q1 q1-1-q2 q2-0-q3 q3-0,1-q3 q0-1-qd q1-0-qd "
DFA += "q2-1-qd qd-0,1-qd]]"
OTHER_DFA = "[[dfa ends01 start=a accept=c a-0-b a-1-a b-0-b b-1-c c-0-b c-1-a]]"
OFFICE = DiagramSpec.model_validate(
    {
        "title": "Office network",
        "direction": "LR",
        "groups": [{"id": "sales", "label": "Sales"}],
        "nodes": [
            {"id": "r1", "label": "Router", "icon": "router"},
            {"id": "p1", "label": "PC 1", "icon": "pc", "group": "sales"},
        ],
        "edges": [{"from": "r1", "to": "p1", "directed": False, "style": "solid"}],
    }
)
CLAIM = "The network is erased; the DFA stays."


def board(*tags, office=True):
    ctx = BoardContext()
    stream = MarkupStream(ctx)
    sentences = stream.feed(" ".join(tags) + " Ready.") + stream.flush()
    assert not [p for s in sentences for p in s.problems]
    if office:
        ctx.diagrams["office"] = OFFICE
    return ctx


async def erase(request, result, ctx, lang="en"):
    c = TutorCoordinator(Thinker(result), ctx, lang=lambda: lang)
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=DRAW)
    text = await spoken(c)
    note = c.notes[-1] if c.notes else None
    await c.close()
    return text, note


@pytest.mark.asyncio
async def test_erasing_the_network_but_keeping_the_dfa_clears_only_the_network():
    text, note = await erase(
        "Please erase the network diagram but keep the DFA.",
        brief().model_copy(update={"say": CLAIM}),
        board(DFA),
    )
    assert note.board == ["[[clear office]]"]
    assert text.startswith("[[clear office]]")
    assert "[[clear starts010]]" not in text and "[[clear]]" not in text
    assert CLAIM in text


@pytest.mark.asyncio
async def test_keep_the_dfa_never_clears_the_dfa_even_when_the_thinker_does():
    text, note = await erase(
        "Erase the network but keep the DFA.",
        brief().model_copy(update={"say": CLAIM, "board": ["[[clear starts010]]"]}),
        board(DFA),
    )
    assert "[[clear starts010]]" not in text
    assert note.board == ["[[clear office]]"]


@pytest.mark.asyncio
async def test_an_ambiguous_erase_gets_the_honest_line_and_no_claim():
    text, note = await erase(
        "Please erase the DFA.",
        brief().model_copy(update={"say": "The DFA is erased."}),
        board(DFA, OTHER_DFA),
    )
    assert "[[clear" not in text and "[[undo" not in text
    assert "erased" not in text.lower()
    assert text == COULD_NOT_ERASE["en"]
    assert note.board == []


@pytest.mark.asyncio
@pytest.mark.parametrize("lang", ["es", "ko"])
async def test_the_honest_line_is_localized(lang):
    text, _ = await erase(
        "Please erase the DFA.",
        brief().model_copy(update={"say": "Listo."}),
        board(DFA, OTHER_DFA),
        lang=lang,
    )
    assert text == COULD_NOT_ERASE[lang]


@pytest.mark.asyncio
async def test_a_brief_that_already_clears_an_item_is_left_alone():
    result = brief().model_copy(
        update={"say": "The network is gone.", "board": ["[[clear office]]"]}
    )
    text, note = await erase("Please erase the network diagram.", result, board(DFA))
    assert note.board == ["[[clear office]]"]
    assert text == "[[clear office]]The network is gone."


@pytest.mark.asyncio
async def test_a_removal_claim_whose_tag_the_checker_refused_is_never_spoken():
    # A bare [[clear]] with two items on the board is refused; "the drawing" fits both.
    text, note = await erase(
        "Can you erase the drawing?",
        brief().model_copy(update={"say": "Everything is erased.", "board": ["[[clear]]"]}),
        board(DFA),
    )
    assert "erased" not in text.lower() and "[[clear" not in text
    assert text == COULD_NOT_ERASE["en"]


@pytest.mark.asyncio
async def test_a_picked_erase_says_so_when_the_brief_did_not():
    text, note = await erase(
        "Remove the automaton, please.",
        brief().model_copy(update={"say": "Which one do you mean?"}),
        # Less than half the board: more would ask first.
        net_board(DFA),
    )
    assert note.board == ["[[clear starts010]]"]
    assert "Which one do you mean?" not in text


@pytest.mark.parametrize(
    ("request_text", "tags"),
    [
        ("Please erase the network diagram but keep the DFA.", ["[[clear office]]"]),
        ("Delete the network.", ["[[clear office]]"]),
        ("Get rid of the office one.", ["[[clear office]]"]),
        ("Erase the DFA.", ["[[clear starts010]]"]),
        ("Remove the automaton.", ["[[clear starts010]]"]),
        ("Remove the state machine but leave the network.", ["[[clear starts010]]"]),
        ("Erase starts010.", ["[[clear starts010]]"]),
        ("Erase everything.", ["[[clear]]"]),
        ("Clear the whole board.", ["[[clear]]"]),
        ("Erase everything except the DFA.", ["[[clear office]]"]),
        ("Erase the drawing.", []),
        ("Erase it.", []),
    ],
)
def test_pick_reads_her_words_against_the_board(request_text, tags):
    assert pick(request_text, board(DFA)) == tags


def test_pick_with_one_item_takes_it_for_it_or_that():
    assert pick("Erase it.", board(DFA, office=False)) == ["[[clear starts010]]"]
    assert pick("Delete that drawing.", board(office=True)) == ["[[clear office]]"]
    # Her words name something that isn't there: never a guess.
    assert pick("Erase the network.", board(DFA, office=False)) == []


def test_pick_with_two_machines_of_one_kind_is_ambiguous_unless_named():
    ctx = board(DFA, OTHER_DFA)
    assert pick("Erase the DFA.", ctx) == []
    assert pick("Erase ends01.", ctx) == ["[[clear ends01]]"]
    assert pick("Erase the network.", ctx) == ["[[clear office]]"]


def test_pick_undo_takes_back_her_last_drawing_turn():
    ctx = board(DFA)
    assert pick("Undo that.", ctx) == []  # nothing to take back yet
    ctx.begin_turn()
    ctx.diagrams.pop("office")
    ctx.end_turn()
    assert pick("Undo that.", ctx) == ["[[undo]]"]


# Exact removals (owner's incident c194768a: "Can you delete the ten dot o dot o diagram" with
# one diagram holding 10.0.0.0/26 and 192.168.1.0/24 came back as a bare [[clear]], and even
# [[clear net]] would have taken the 192.168 zone too).
NET = DiagramSpec.model_validate(
    {
        "title": "Subnets",
        "direction": "LR",
        "groups": [
            {"id": "lan10", "label": "Internal", "sublabel": "10.0.0.0/26"},
            {"id": "p2", "label": "Problem 2", "sublabel": "192.168.1.0/24"},
            {"id": "guest", "label": "Guest"},
        ],
        "nodes": [
            {"id": "core", "label": "Core", "icon": "router"},
            {
                "id": "r10",
                "label": "R10",
                "sublabel": "10.0.0.1",
                "icon": "router",
                "group": "lan10",
            },
            {"id": "pc1", "label": "PC 1", "sublabel": "10.0.0.2", "icon": "pc", "group": "lan10"},
            {"id": "sw", "label": "Switch", "icon": "switch", "group": "p2"},
            {"id": "pc3", "label": "PC 3", "icon": "pc", "group": "p2"},
            {"id": "pc4", "label": "PC 4", "icon": "pc", "group": "p2"},
            {"id": "ap", "label": "Access point", "icon": "box", "group": "guest"},
            {"id": "srv", "label": "Server", "icon": "server"},
        ],
        "edges": [
            {"from": "core", "to": "r10", "directed": False, "style": "solid"},
            {"from": "core", "to": "sw", "directed": False, "style": "solid"},
            {"from": "core", "to": "ap", "directed": False, "style": "solid"},
        ],
    }
)


def net_board(*tags):
    ctx = board(*tags, office=False)
    ctx.diagrams["net"] = NET
    return ctx


@pytest.mark.parametrize(
    ("request_text", "tags"),
    [
        ("Can you delete the ten dot o dot o diagram", ["[[remove net.lan10]]"]),
        ("Can you delete the ten dot o dot o diagram network.", ["[[remove net.lan10]]"]),
        ("Remove the 10.0.0.0/26 network", ["[[remove net.lan10]]"]),
        ("Erase the one ninety two dot one sixty eight network", ["[[remove net.p2]]"]),
        ("Remove problem two", ["[[remove net.p2]]"]),
        ("Remove the guest zone", ["[[remove net.guest]]"]),
        ("Remove the PCs", ["[[remove net.pc1 net.pc3 net.pc4]]"]),
        ("Remove the PCs in the guest zone", []),
        ("Remove the PCs in problem 2", ["[[remove net.pc3 net.pc4]]"]),
        ("Delete PC 3", ["[[remove net.pc3]]"]),
        ("Delete the server", ["[[remove net.srv]]"]),
        ("Delete the router", []),
        ("Delete the whole network diagram", ["[[clear net]]"]),
        ("Delete the network", ["[[clear net]]"]),
    ],
)
def test_pick_resolves_her_words_down_to_zones_and_nodes(request_text, tags):
    assert pick(request_text, net_board()) == tags


def test_pick_removes_a_state_or_the_notes():
    ctx = net_board(DFA, '[[note n1 "dead" near=starts010:qd]] [[note n2 "start"]]')
    assert pick("Remove state qd", ctx) == ["[[remove starts010.qd]]"]
    assert pick("Delete the notes", ctx) == ["[[clear n1]]", "[[clear n2]]"]


def test_share_counts_what_a_removal_takes_off_the_board():
    ctx = net_board()
    assert share(["[[remove net.lan10]]"], ctx) == pytest.approx(2 / 8)
    assert share(["[[clear]]"], ctx) == 1.0
    assert share(["[[undo]]"], ctx) == 0.0


@pytest.mark.asyncio
async def test_the_incident_removes_only_the_named_zone_even_over_a_bare_clear():
    said = "Done, the 10.0.0.0 network is gone."
    text, note = await erase(
        "Can you delete the ten dot o dot o diagram",
        brief().model_copy(update={"say": said, "board": ["[[clear]]"]}),
        net_board(),
    )
    assert note.board == ["[[remove net.lan10]]"]
    assert text.startswith("[[remove net.lan10]]")


@pytest.mark.asyncio
async def test_a_clear_of_the_whole_item_gives_way_to_the_part_she_named():
    _, note = await erase(
        "Remove the guest zone",
        brief().model_copy(update={"say": "The guest zone is gone.", "board": ["[[clear net]]"]}),
        net_board(),
    )
    assert note.board == ["[[remove net.guest]]"]


@pytest.mark.asyncio
async def test_a_removal_of_more_than_half_the_board_asks_first_and_yes_carries_it_out():
    ctx = net_board()
    c = TutorCoordinator(Thinker(brief().model_copy(update={"say": "Cleared."})), ctx)
    request = "Clear everything."
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=DRAW)
    text = await spoken(c)
    assert "[[" not in text and text == ASK_ALL["en"]
    assert "net" in ctx.diagrams
    assert c.pending_removal == (["[[clear]]"], request)
    await c.prepare(LLMContext([{"role": "user", "content": "Yes."}]), "Yes.", decision=DRAW)
    text = await spoken(c)
    assert text.startswith("[[clear]]")
    assert c.pending_removal is None
    await c.close()


@pytest.mark.asyncio
async def test_anything_but_yes_drops_the_pending_removal():
    c = TutorCoordinator(Thinker(brief().model_copy(update={"say": "Okay."})), net_board())
    await c.prepare(LLMContext([]), "Erase everything.", decision=DRAW)
    await spoken(c)
    assert c.pending_removal
    await c.prepare(LLMContext([]), "No, wait.", decision=DRAW)
    assert c.pending_removal is None
    await c.close()


@pytest.mark.parametrize(
    ("request_text", "tags"),
    [
        ("Rename problem two to Sales floor.", ['[[rename net.p2 "Sales floor"]]']),
        ("Rename the guest zone to Visitors", ['[[rename net.guest "Visitors"]]']),
        ("Call the server Backup instead.", []),
        ("Rename the network to Campus", ['[[rename net "Campus"]]']),
        ("Rename the PCs to Desktops", []),
    ],
)
def test_pick_rename_names_one_part(request_text, tags):
    assert pick_rename(request_text, net_board()) == tags


@pytest.mark.asyncio
async def test_a_rename_turn_renames_in_place_without_a_redraw():
    text, note = await erase(
        "Rename problem two to Sales floor.",
        brief().model_copy(update={"say": "Sure.", "draw": "the same diagram, renamed"}),
        net_board(),
    )
    assert note.board == ['[[rename net.p2 "Sales floor"]]'] and note.draw is None
    assert text == '[[rename net.p2 "Sales floor"]]Done, it\'s called Sales floor now.'


def test_confirm_reads_a_yes():
    assert CONFIRM.match("Yes.") and CONFIRM.match("yeah go ahead") and CONFIRM.match("네")
    assert not CONFIRM.match("no") and not CONFIRM.match("yesterday I drew")
