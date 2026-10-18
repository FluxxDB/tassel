"""The diagram checklist's deterministic checks, the automaton checklist from her words, and the
Illustrator's generate, verify and repair loop on fakes."""

import json
from types import SimpleNamespace

import pytest

from tassel.beats.markup import BoardContext
from tassel.beats.models import AutomatonSpec, DiagramSpec
from tassel.voice.illustrator import Illustrator, recent_turns
from tassel.voice.requirements import (
    Checklist,
    automaton_checklist,
    checklist_schema,
    verify,
    verify_automaton,
)
from tassel.voice.settings import VoiceSettings


def node(id, label, icon, group=None, sublabel=None):
    return dict(id=id, label=label, icon=icon, group=group, sublabel=sublabel)


def edge(a, b):
    return {"from": a, "to": b, "directed": False, "style": "solid"}


OFFICE = dict(
    direction="LR",
    groups=[
        dict(id="s", label="Sales", sublabel="10.1.0.0/26"),
        dict(id="g", label="Guest Wi-Fi", sublabel="10.1.0.64/28"),
        dict(id="c", label="Core"),
    ],
    nodes=[
        node("core", "Core Switch", "switch", "c"),
        node("rt", "Edge Router", "router", "c"),
        node("s1", "Sales switch", "switch", "s"),
        node("p1", "PC 1", "pc", "s"),
        node("p2", "PC 2", "pc", "s"),
        node("g1", "Guest switch", "switch", "g"),
        node("p3", "PC 3", "pc", "g"),
    ],
    edges=[edge("s1", "core"), edge("core", "rt"), edge("p1", "s1"), edge("p2", "s1")],
)


def req(kind, text, **fields):
    base = dict(
        kind=kind,
        text=text,
        group=None,
        label=None,
        icon=None,
        n=None,
        exact=False,
        source=None,
        target=None,
        each=False,
        direction=None,
    )
    return {**base, **fields}


def checklist(*reqs, item=None, remove=()):
    return Checklist.model_validate(dict(item=item, remove=list(remove), requirements=list(reqs)))


def missing(spec, *reqs, before=None, remove=()):
    found = verify(DiagramSpec.model_validate(spec), checklist(*reqs, remove=remove), before)
    return [why for _, why in found]


def test_checks_groups_counts_labels_edges_and_hosts():
    ends = lambda **e: {"label": None, "icon": None, "group": None, **e}  # noqa: E731
    assert (
        missing(
            OFFICE,
            req("group", "Sales zone", label="Sales"),
            req("count", "two PCs in Sales", group="Sales", icon="pc", n=2, exact=True),
            req("label", "Edge Router", label="edge router"),
            req(
                "edge",
                "Core to router",
                source=ends(label="Core Switch"),
                target=ends(icon="router"),
            ),
            req("cidr", "Sales fits 50", group="Sales", n=50, exact=True),
            req("direction", "left to right", direction="LR"),
        )
        == []
    )
    misses = missing(
        OFFICE,
        req("group", "HR zone", label="HR"),
        req("count", "two PCs in Guest", group="Guest", icon="pc", n=2, exact=True),
        req("label", "a NAS", label="NAS"),
        req(
            "edge",
            "every zone switch to the core",
            source=ends(icon="switch", group="*"),
            target=ends(label="Core Switch"),
            each=True,
        ),
        req("cidr", "Guest fits 20", group="Guest", n=20),
        req("cidr", "Sales is the smallest for 30", group="Sales", n=30, exact=True),
    )
    assert misses == [
        "no group labeled 'HR'",
        "Guest Wi-Fi has 1 pc, wanted 2",
        "no label 'NAS'",
        "Guest switch not connected to Core Switch",
        "Guest's subnet has 14 usable hosts, needs 20",
        "Sales should be the smallest subnet for 30 hosts (/27)",
    ]


def test_an_edit_keeps_every_part_under_its_id_unless_she_removed_it():
    before = DiagramSpec.model_validate(OFFICE)
    renamed = {
        **OFFICE,
        "nodes": [{**n, "id": n["id"] + "x"} if n["id"] == "p3" else n for n in OFFICE["nodes"]],
    }
    assert missing(renamed, before=before) == ["keep the id p3 for 'PC 3' (it became p3x)"]
    dropped = {
        **OFFICE,
        "groups": OFFICE["groups"][::2],
        "nodes": [n for n in OFFICE["nodes"] if n["group"] != "g"],
    }
    assert "keep 'Guest Wi-Fi' (id g); she didn't ask to remove it" in missing(
        dropped, before=before
    )
    # Removing the Guest zone (by id, or its one exact label) takes its devices with it.
    assert missing(dropped, before=before, remove=["g"]) == []
    assert missing(dropped, before=before, remove=["Guest Wi-Fi"]) == []
    # A generic label names no part: "PC" never excuses dropping Sales' PCs (live dd-after).
    no_pcs = {
        **OFFICE,
        "nodes": [n for n in OFFICE["nodes"] if n["id"] not in ("p1", "p2")],
        "edges": OFFICE["edges"][:2],
    }
    assert missing(no_pcs, before=before, remove=["PC", "Switch"]) == [
        "keep 'PC 1' (id p1); she didn't ask to remove it",
        "keep 'PC 2' (id p2); she didn't ask to remove it",
    ]
    relabeled = {
        **OFFICE,
        "groups": [{**OFFICE["groups"][0], "label": "Retail"}, *OFFICE["groups"][1:]],
    }
    assert missing(relabeled, before=before) == [
        "keep 'Sales' as it was (id s); she didn't rename it"
    ]


def test_checklist_schema_is_strict():
    schema = checklist_schema()
    for node_ in [schema, *schema["$defs"].values()]:
        if "properties" in node_:
            assert set(node_["required"]) == set(node_["properties"])
            assert node_["additionalProperties"] is False


@pytest.mark.parametrize(
    "text,states,accepting,alphabet",
    [
        ("Draw a DFA with 3 states over {a,b} with one accepting state", 3, 1, ["a", "b"]),
        ("a DFA for binary strings ending in 01", None, None, ["0", "1"]),
        ("an NFA with at most four states over a and b", 4, None, ["a", "b"]),
        ("draw a DFA for strings that start with 010", None, None, None),
    ],
)
def test_automaton_checklist_from_her_words(text, states, accepting, alphabet):
    wanted = automaton_checklist(text)
    assert (wanted.states, wanted.accepting, wanted.alphabet) == (states, accepting, alphabet)


def test_verify_automaton_names_what_she_asked_for():
    spec = AutomatonSpec.model_validate(
        dict(
            kind="dfa",
            states=[dict(id="q0"), dict(id="q1", accept=True)],
            start="q0",
            transitions=[
                {"from": "q0", "to": "q1", "symbols": ["a"]},
                {"from": "q1", "to": "q1", "symbols": ["a"]},
                {"from": "q0", "to": "q0", "symbols": ["b"]},
                {"from": "q1", "to": "q0", "symbols": ["b"]},
            ],
        )
    )
    wanted = automaton_checklist("a DFA with 3 states and 2 accepting states over {a,b,c}")
    assert verify_automaton(spec, wanted) == [
        "2 states, she asked for exactly 3",
        "1 accepting states, she asked for 2",
        "no transition reads ['c']",
    ]
    assert verify_automaton(spec, automaton_checklist("2 states over {a,b}")) == []


class Client:
    """Fake chat completions: answers by response_format name, in order."""

    def __init__(self, **answers):
        self.answers = {k: list(v) for k, v in answers.items()}
        self.requests = []
        self.chat = self.completions = self

    async def create(self, **request):
        self.requests.append(request)
        name = request["response_format"].get("json_schema", {}).get("name", "drawing")
        answer = self.answers[name].pop(0)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(answer)))],
            usage=None,
        )

    async def close(self):
        pass


SALES_TWO_PCS = dict(
    item=None,
    remove=[],
    requirements=[req("count", "two PCs in Sales", group="Sales", icon="pc", n=2, exact=True)],
)


def drawing(pcs):
    return dict(
        item="net",
        spec=dict(
            direction="LR",
            title=None,
            groups=[dict(id="s", label="Sales", sublabel=None)],
            nodes=[node(f"p{i}", f"PC {i}", "pc", "s") for i in range(1, pcs + 1)],
            edges=[],
        ),
    )


@pytest.mark.asyncio
async def test_her_words_reach_the_illustrator_and_misses_are_repaired():
    events = []
    client = Client(checklist=[SALES_TWO_PCS], drawing=[drawing(1), drawing(2)])
    illustrator = Illustrator(
        VoiceSettings(illustrator_provider="openrouter"),
        client=client,
        log=lambda e, **d: events.append((e, d)),
    )
    recent = [{"role": "user", "text": "The zone is called Sales."}]
    drawn = await illustrator.draw(
        "a sales zone", BoardContext(), "en", request="Two PCs in Sales, please.", recent=recent
    )
    assert drawn.item == "net" and drawn.missing == [] and len(drawn.spec.nodes) == 2
    first = json.loads(client.requests[1]["messages"][1]["content"])
    assert first["her_words"] == "Two PCs in Sales, please."
    assert first["recent_turns"] == recent
    assert first["must_include"] == ["two PCs in Sales"]
    repair = client.requests[2]["messages"][-1]["content"]
    assert "two PCs in Sales (Sales has 1 pc, wanted 2)" in repair
    checks = [d for e, d in events if e == "illustrator_check"]
    assert checks[0]["missing"] == ["two PCs in Sales: Sales has 1 pc, wanted 2"]
    assert checks[1]["missing"] == []
    assert any(e == "illustrator_checklist" for e, _ in events)


@pytest.mark.asyncio
async def test_two_repairs_then_the_partial_drawing_names_what_it_misses():
    events = []
    client = Client(checklist=[SALES_TWO_PCS], drawing=[drawing(1)] * 3)
    illustrator = Illustrator(
        VoiceSettings(illustrator_provider="openrouter"),
        client=client,
        log=lambda e, **d: events.append((e, d)),
    )
    drawn = await illustrator.draw("sales", BoardContext(), "en", request="two PCs in Sales")
    assert drawn.missing == ["two PCs in Sales"]
    assert len(client.requests) == 4  # the checklist, the drawing, two repairs
    assert ("illustrator_unmet", {"item": "net", "missing": ["two PCs in Sales"]}) in events


@pytest.mark.asyncio
async def test_a_failed_checklist_still_draws_and_logs_why():
    events = []

    class Broken(Client):
        async def create(self, **request):
            if request["response_format"]["json_schema"]["name"] == "checklist":
                raise ValueError("bad checklist")
            return await super().create(**request)

    illustrator = Illustrator(
        VoiceSettings(illustrator_provider="openrouter"),
        client=Broken(drawing=[drawing(1)]),
        log=lambda e, **d: events.append((e, d)),
    )
    drawn = await illustrator.draw("sales", BoardContext(), "en", request="a sales zone")
    assert drawn.missing == []
    reject = next(d for e, d in events if e == "reject")
    assert reject == {"source": "checklist", "reason": "ValueError: bad checklist"}


@pytest.mark.asyncio
async def test_fuzzy_items_go_to_the_model_check():
    fuzzy = dict(item=None, remove=[], requirements=[req("fuzzy", "a star layout")])
    client = Client(
        checklist=[fuzzy],
        drawing=[drawing(1), drawing(1)],
        fuzzy=[
            {"results": [{"i": 0, "ok": False, "why": "it's a line"}]},
            {"results": [{"i": 0, "ok": True, "why": "star"}]},
        ],
    )
    illustrator = Illustrator(VoiceSettings(illustrator_provider="openrouter"), client=client)
    drawn = await illustrator.draw("star", BoardContext(), "en", request="a star network")
    assert drawn.missing == []
    assert "a star layout (it's a line)" in client.requests[3]["messages"][-1]["content"]


def test_recent_turns_skip_her_current_words_and_system_notes():
    messages = [
        {"role": "system", "content": "notes"},
        {"role": "user", "content": "I need subnets of 10, 20 and 50."},
        {"role": "assistant", "content": [{"type": "text", "text": "Got it."}]},
        {"role": "user", "content": "Draw all these subnets."},
    ]
    assert recent_turns(messages) == [
        {"role": "user", "text": "I need subnets of 10, 20 and 50."},
        {"role": "assistant", "text": "Got it."},
    ]


def test_check_tags_holds_a_finished_machine_to_her_checklist():
    from tassel.voice.action_checker import CHECKLIST_REPAIR, check_tags
    from tassel.voice.director import rules

    two = "[[dfa d start=q0 accept=q1 q0-a-q1 q1-a-q1 q0-b-q0 q1-b-q0]]"
    decision = rules("draw a DFA")
    wanted = automaton_checklist("a DFA with 3 states over {a,b}")
    checked = check_tags([two], decision, BoardContext(), checklist=wanted)
    assert checked.repair == CHECKLIST_REPAIR + "2 states, she asked for exactly 3."
    assert not checked.tags and checked.reasons[two] == checked.repair
    ok = check_tags([two], decision, BoardContext(), checklist=automaton_checklist("2 states"))
    assert ok.repair is None and ok.tags == [two]


def test_rejected_tags_carry_a_reason():
    from tassel.voice.action_checker import check_tags
    from tassel.voice.director import rules

    checked = check_tags(["[[circle m1]]", "not a tag"], rules("draw a DFA"), BoardContext())
    assert checked.reasons["not a tag"] == "not one [[…]] tag"
    assert "not allowed on a draw_board turn" in checked.reasons["[[circle m1]]"]


def test_director_fallback_reasons_are_words():
    from pydantic import BaseModel, ValidationError

    from tassel.voice.director import fallback_reason

    class M(BaseModel):
        route: int

    try:
        M.model_validate({"route": "x"})
    except ValidationError as error:
        invalid = error
    assert fallback_reason(TimeoutError(), 0.8) == "no decision within 0.8 s"
    assert fallback_reason(invalid, 0.8).startswith("invalid decision at route:")
    assert fallback_reason(RuntimeError("secret"), 0.8) == "RuntimeError calling the director"


def test_two_page_reads_disagree_on_a_value_of_the_same_shape():
    from tassel.voice.thinker import read_disagreement

    assert read_disagreement("10.0.0.0/24 for 30 hosts", "10.0.0.0/26 for 30 hosts") == [
        "10.0.0.0/24 vs 10.0.0.0/26"
    ]
    assert read_disagreement("Sales 30 hosts", "Sales: 50 hosts") == ["30 vs 50"]
    assert read_disagreement("10.0.0.0/24", "the subnet 10.0.0.0/24, Sales") == []
    assert read_disagreement("q0 to q1", "a DFA") == []


@pytest.mark.asyncio
async def test_a_pointer_id_away_from_its_own_box_falls_back_to_the_box():
    from tassel.beats.models import DetectedElement
    from tassel.voice.pointer import MarkIntent, Pointer

    class Answer(Client):
        async def create(self, **request):
            box = {"x": 0.8, "y": 0.8, "w": 0.1, "h": 0.1}
            content = json.dumps({"marks": [{"i": 0, "id": "m1", "box": box}]})
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))], usage=None
            )

    logs = []
    pointer = Pointer(VoiceSettings(), client=Answer(), log=lambda e, **d: logs.append((e, d)))
    m1 = DetectedElement(id="m1", kind="circle", box=dict(x=10, y=10, w=50, h=50))
    intent = MarkIntent(verb="circle", target="the accepting state")
    [(verb, target, _, _)] = await pointer.resolve(
        [intent], b"jpeg", "m1 circle at top left", [m1], size=(1000, 1000)
    )
    assert verb == "circle" and target.startswith("box=")
    assert any(d.get("reason") == "id away from its box" for _, d in logs)
