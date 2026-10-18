"""Ada's board markup: [[verb args…]] tags in her text, parsed into beat actions as it streams."""

import json
from pathlib import Path

import pytest

from tassel.beats.markup import BoardContext, MarkupStream, Sentence, parse_command
from tassel.beats.models import BEAT_ACTION, AutomatonSpec, PaperElements

CASES = json.loads((Path(__file__).parent / "markup-fixtures.json").read_text(encoding="utf-8"))

WRONG_TAG = "[[dfa wrong start=q0 accept=q3 q0-0-q1 q1-1-q2 q2-0-q3 q3-0,1-q3 q0-1-q0]]"
CORRECT_TAG = (
    "[[dfa fix hidden start=q0 accept=q3 "
    "q0-0-q1 q1-1-q2 q2-0-q3 q3-0,1-q3 q0-1-qd q1-0-qd q2-1-qd qd-0,1-qd]]"
)


def read(*chunks: str, ctx: BoardContext | None = None) -> list[Sentence]:
    """Streams `chunks` as one response, then ends it."""
    stream = MarkupStream(ctx if ctx is not None else BoardContext(specs={}))
    sentences = [s for chunk in chunks for s in stream.feed(chunk)]
    return sentences + stream.flush()


def anchors(sentence: Sentence) -> list[list[object]]:
    return [
        [word, BEAT_ACTION.dump_python(action, mode="json")] for word, action in sentence.anchors
    ]


def dump(action) -> dict:
    return BEAT_ACTION.dump_python(action, mode="json")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_markup_fixtures(case):
    [sentence] = read(case["text"])

    assert sentence.clean == case["clean"]
    assert anchors(sentence) == case["anchors"]
    assert len(sentence.problems) == case.get("problems", 0)


def test_a_dfa_tag_anchors_the_automaton_at_word_0():
    [sentence] = read(f"{CORRECT_TAG}Here's one that works.")

    [(word, action)] = sentence.anchors
    assert word == 0
    assert action.kind == "board.automaton"
    assert action.reveal == "none"
    assert [s.id for s in action.spec.states] == ["q0", "q1", "q2", "q3", "qd"]


def test_a_tag_anchors_to_the_word_that_starts_after_it():
    [sentence] = read("We start at [[reveal fix start q0]]q zero.")

    assert sentence.clean == "We start at q zero."
    assert sentence.tagged == "We start at [[reveal fix start q0]]q zero."
    assert [word for word, _ in sentence.anchors] == [3]


def test_a_korean_callout_keeps_its_quoted_string():
    [sentence] = read('[[callout q3 "q3에 머물면 수락해요."]]여기서 끝나요.')

    [(word, action)] = sentence.anchors
    assert (word, action.mark.type, action.mark.text) == (0, "callout", "q3에 머물면 수락해요.")
    assert action.mark.target.el == "state:q3"


def test_an_unknown_verb_leaves_clean_text_and_one_problem():
    [sentence] = read("Let me [[erase fix]]think.")

    assert sentence.clean == "Let me think."
    assert sentence.anchors == []
    assert len(sentence.problems) == 1
    assert "erase" in sentence.problems[0]


def test_single_brackets_are_text():
    [sentence] = read("[0,1]")

    assert (sentence.clean, sentence.anchors, sentence.problems) == ("[0,1]", [], [])


class TestMarkupStream:
    def test_a_tag_split_across_three_chunks_gives_the_same_sentence_as_unsplit_text(self):
        text = "We start at [[reveal fix start q0]]q zero."
        whole = read(text)

        assert read("We start at [[rev", "eal fix sta", "rt q0]]q zero.") == whole
        assert read("We start at [", "[reveal fix start q0]", "]q zero.") == whole
        assert read(*text) == whole

    def test_two_sentences_in_one_chunk_come_out_as_two(self):
        sentences = read("This is your DFA. Let's try 1010 on it.")

        assert [s.clean for s in sentences] == ["This is your DFA.", "Let's try 1010 on it."]

    def test_a_sentence_comes_out_once_text_follows_it(self):
        stream = MarkupStream(BoardContext(specs={}))

        assert [s.clean for s in stream.feed("This is your DFA. Let's try")] == [
            "This is your DFA."
        ]
        # It ends where the stream does, so it waits: a tag may follow.
        assert stream.feed(" 1010 on it.") == []
        assert [s.clean for s in stream.flush()] == ["Let's try 1010 on it."]

    def test_an_unclosed_tag_at_the_end_of_a_response_is_dropped(self):
        [sentence] = read("That's the fix. [[reveal fix sta")

        assert sentence.clean == "That's the fix."
        assert sentence.anchors == []
        assert len(sentence.problems) == 1

    def test_trace_copies_the_spec_of_the_automaton_it_names(self):
        ctx = BoardContext(specs={})
        [sentence] = read(f"{WRONG_TAG}[[trace run wrong 1010 student]]Let's run 1010.", ctx=ctx)

        [(_, automaton), (_, trace)] = sentence.anchors
        assert trace.kind == "board.trace"
        assert (trace.item, trace.on, trace.input, trace.subject) == (
            "run",
            "wrong",
            "1010",
            "student",
        )
        assert trace.spec == automaton.spec == ctx.specs["wrong"]

    def test_tags_after_the_last_word_attach_to_the_sentence_as_end_markers(self):
        [sentence] = read("That loop is the bug. [[highlight wrong q0>q0]] [[pulse wrong q0]]")

        assert [word for word, _ in sentence.anchors] == [5, 5]
        assert (
            sentence.tagged == "That loop is the bug. [[highlight wrong q0>q0]] [[pulse wrong q0]]"
        )

    def test_a_finished_sentence_waits_for_text_that_is_not_a_tag(self):
        stream = MarkupStream(BoardContext(specs={}))

        assert stream.feed("That loop is the bug. ") == []
        assert stream.feed("[[highlight wrong q0>q0]] ") == []
        [held] = stream.feed("Now")
        assert held.clean == "That loop is the bug."
        assert held.anchors == []
        [last] = stream.flush()
        assert last.clean == "Now"
        assert [word for word, _ in last.anchors] == [0]

    def test_tags_between_sentences_anchor_to_the_first_word_after_them(self):
        first, second = read("That's yours. [[reveal fix]] Here's mine.")

        assert first.anchors == []
        assert [word for word, _ in second.anchors] == [0]
        assert second.tagged == "[[reveal fix]] Here's mine."

    def test_a_tag_glued_to_a_full_stop_still_ends_the_sentence(self):
        first, second = read("That's yours.[[reveal fix]] Here's mine.")

        assert (first.clean, first.anchors) == ("That's yours.", [])
        assert [word for word, _ in second.anchors] == [0]

    def test_a_response_with_no_words_gives_one_tags_only_sentence(self):
        [sentence] = read("[[stage split]] [[focus fix]]")

        assert sentence.clean == ""
        assert [word for word, _ in sentence.anchors] == [0, 0]

    def test_a_full_stop_inside_a_word_or_a_tag_ends_nothing(self):
        [sentence] = read('Wait 1.5 seconds, then [[note why "Done. Next."]]look.')

        assert sentence.clean == "Wait 1.5 seconds, then look."
        assert len(sentence.anchors) == 1

    def test_question_and_exclamation_marks_end_sentences(self):
        sentences = read("Where does it end?! In q3. Right!")

        assert [s.clean for s in sentences] == ["Where does it end?!", "In q3.", "Right!"]

    def test_a_long_sentence_splits_within_the_beat_limits(self):
        words = [f"w{i}" for i in range(170)]
        text = " ".join(words[:100]) + " [[pulse wrong q0]]" + " ".join(words[100:]) + "."
        sentences = read(text)

        assert [len(s.clean.split()) for s in sentences] == [80, 80, 10]
        assert " ".join(s.clean for s in sentences) == " ".join(words) + "."
        assert [s.anchors and s.anchors[0][0] for s in sentences] == [[], 20, []]
        assert " ".join(s.tagged for s in sentences) == text

    def test_a_sentence_past_400_code_points_splits_too(self):
        text = " ".join(["Bucle"] * 70) + "."
        sentences = read(text)

        assert all(len(s.clean) <= 400 for s in sentences)
        assert " ".join(s.clean for s in sentences) == text

    def test_more_than_40_tags_without_words_split_into_beats_of_40(self):
        sentences = read("[[pulse wrong q0]]" * 45)

        assert [len(s.anchors) for s in sentences] == [40, 5]
        assert all(s.clean == "" for s in sentences)


class TestParseCommand:
    @pytest.mark.parametrize(
        ("command", "action"),
        [
            ("reveal fix", {"kind": "board.reveal", "item": "fix"}),
            (
                "add fix q4 accept",
                {"kind": "board.addState", "item": "fix", "id": "q4", "accept": True},
            ),
            ("add fix q4", {"kind": "board.addState", "item": "fix", "id": "q4"}),
            (
                "edge fix q3 q4 0,1",
                {
                    "kind": "board.addTransition",
                    "item": "fix",
                    "from": "q3",
                    "to": "q4",
                    "symbols": ["0", "1"],
                },
            ),
            (
                "highlight fix q1>q2",
                {"kind": "board.highlight", "item": "fix", "el": "edge:q1>q2", "on": True},
            ),
            (
                "unhighlight fix start",
                {"kind": "board.highlight", "item": "fix", "el": "start", "on": False},
            ),
            ("pulse fix qd", {"kind": "board.pulse", "item": "fix", "el": "state:qd"}),
            ('note why "Look here."', {"kind": "board.note", "item": "why", "text": "Look here."}),
            ("step run", {"kind": "board.traceStep", "item": "run"}),
            ("verdict run reject", {"kind": "board.verdict", "item": "run", "got": "reject"}),
            ("focus fix", {"kind": "board.focus", "item": "fix"}),
            ("focus", {"kind": "board.focus"}),
            ("clear run", {"kind": "board.clear", "item": "run"}),
            ("clear", {"kind": "board.clear"}),
            ("stage board", {"kind": "stage", "view": "board"}),
            ("ptrace 1010", {"kind": "paper.trace", "input": "1010"}),
            ("pstep", {"kind": "paper.traceStep"}),
            ("live", {"kind": "paper.live"}),
            ("freeze latest", {"kind": "paper.freeze", "frame": {"kind": "latest"}}),
            (
                "freeze frame=6f1c2d3e-4b5a",
                {"kind": "paper.freeze", "frame": {"kind": "frame", "id": "6f1c2d3e-4b5a"}},
            ),
            ("REVEAL fix", {"kind": "board.reveal", "item": "fix"}),
        ],
    )
    def test_each_verb_makes_its_action(self, command, action):
        assert dump(parse_command(command, BoardContext(specs={}))) == action

    def test_paper_marks_number_themselves_from_the_context(self):
        ctx = BoardContext(specs={})
        marks = [
            dump(parse_command(command, ctx))["mark"]
            for command in (
                "circle q0>q0",
                "wash q0>q0",
                "number 2 q1",
                "strike q2>q3",
                "check q3",
                'callout start "Start here."',
            )
        ]

        assert marks == [
            {"type": "circle", "id": "m1", "target": {"el": "edge:q0>q0"}},
            {"type": "circle", "id": "m2", "target": {"el": "edge:q0>q0"}, "wash": True},
            {"type": "step", "id": "m3", "n": 2, "target": {"el": "state:q1"}},
            {"type": "strike", "id": "m4", "target": {"el": "edge:q2>q3"}},
            {"type": "check", "id": "m5", "target": {"el": "state:q3"}},
            {"type": "callout", "id": "m6", "target": {"el": "start"}, "text": "Start here."},
        ]
        assert ctx.next_mark == 7

    def test_nfa_takes_eps_for_epsilon(self):
        ctx = BoardContext(specs={})
        action = parse_command("nfa guess start=p0 accept=p2 p0-0,1-p0 p0-eps-p1 p1-0-p2", ctx)

        assert dump(action)["spec"] == {
            "kind": "nfa",
            "states": [{"id": "p0"}, {"id": "p1"}, {"id": "p2", "accept": True}],
            "start": "p0",
            "transitions": [
                {"from": "p0", "to": "p0", "symbols": ["0", "1"]},
                {"from": "p0", "to": "p1", "symbols": ["ε"]},
                {"from": "p1", "to": "p2", "symbols": ["0"]},
            ],
        }

    def test_dfa_takes_a_title(self):
        action = parse_command(
            'dfa fix title="A DFA that works" start=q0 accept=q1 q0-0-q1', BoardContext(specs={})
        )

        assert (action.title, action.reveal) == ("A DFA that works", None)

    def test_add_and_edge_keep_the_remembered_spec_in_step(self):
        ctx = BoardContext(specs={})
        parse_command("dfa fix start=q0 accept=q1 q0-0-q1", ctx)
        parse_command("add fix qd", ctx)
        parse_command("edge fix q0 qd 1", ctx)
        trace = parse_command("trace run fix 01", ctx)

        assert [s.id for s in trace.spec.states] == ["q0", "q1", "qd"]
        assert [(t.from_, t.to, t.symbols) for t in trace.spec.transitions] == [
            ("q0", "q1", ["0"]),
            ("q0", "qd", ["1"]),
        ]

    def test_clear_forgets_the_automaton(self):
        ctx = BoardContext(specs={})
        parse_command("dfa fix start=q0 accept=q1 q0-0-q1", ctx)
        parse_command("clear fix", ctx)

        assert parse_command("trace run fix 0", ctx) is None
        assert ctx.specs == {}

    def test_freeze_brings_the_paper_context(self):
        elements = PaperElements.model_validate(
            {"states": {"q0": {"center": {"x": 0.2, "y": 0.5}, "r": 0.05}}, "edges": {}}
        )
        spec = AutomatonSpec.model_validate(
            {"kind": "dfa", "states": [{"id": "q0"}], "start": "q0", "transitions": []}
        )
        ctx = BoardContext(specs={}, paper_elements=elements, paper_spec=spec)

        action = dump(parse_command("freeze", ctx))

        assert action["frame"] == {"kind": "latest"}
        assert action["elements"]["states"]["q0"]["r"] == 0.05
        assert action["spec"]["start"] == "q0"

    @pytest.mark.parametrize(
        "command",
        [
            "",
            "erase fix",
            "reveal",
            "reveal fix q0>",
            "add fix",
            "add fix q 4",
            "edge fix q0 q1",
            "highlight fix",
            'note why "unclosed',
            "note why",
            "trace run nowhere 1010",
            "step",
            "verdict run maybe",
            "stage both",
            "circle",
            "number x q0",
            "number 100 q0",
            'callout q0 ""',
            "freeze frame=",
            "freeze yesterday",
            "focus fix extra",
            "dfa fix q0-0-q1",
            "dfa fix start=q0 q0-eps-q1",
            "dfa fix start=_q _q-0-_q",
            "dfa x.y start=q0 q0-0-q0",
            "ptrace " + "1" * 65,
        ],
    )
    def test_a_bad_command_is_none(self, command):
        assert parse_command(command, BoardContext(specs={})) is None

    def test_a_failed_mark_takes_no_number(self):
        ctx = BoardContext(specs={})

        assert parse_command("number 100 q0", ctx) is None
        assert parse_command("circle q0", ctx).mark.id == "m1"

    def test_a_trace_input_of_64_symbols_is_fine(self):
        ctx = BoardContext(specs={})
        parse_command("dfa fix start=q0 accept=q0 q0-0,1-q0", ctx)

        assert parse_command("trace run fix " + "01" * 32, ctx).input == "01" * 32
        assert parse_command("trace run fix " + "01" * 32 + "0", ctx) is None


# What Qwen 3.8 actually wrote with Ada's persona, asked to draw a DFA for strings that start
# with 010 (main's live run, 2026-10-17): commas, a state list, arrows, an edge with no symbol,
# and an ellipsis. The tolerant reading keeps everything unambiguous and says what it dropped.
QWEN_DFA = (
    "dfa dfa1 hidden start=q0 accept=q5 q0, q1, q2, q3, q4, q5, q6 q0-0->q1, q1-1->q2, "
    "q2-0->q3, q3-1->q4, q4->q5, q0-1->q6, ..."
)


class TestTolerantTags:
    def moves(self, action) -> list[tuple[str, str, list[str]]]:
        return [(m.from_, m.to, list(m.symbols)) for m in action.spec.transitions]

    def test_the_real_qwen_dfa_draws_what_it_can_and_names_what_it_dropped(self):
        sentences = read(f"[[{QWEN_DFA}]] [[reveal dfa1]]Here it is.")
        [sentence] = sentences
        [(_, automaton), (_, reveal)] = sentence.anchors
        assert automaton.kind == "board.automaton" and automaton.reveal == "none"
        assert [s.id for s in automaton.spec.states] == [f"q{i}" for i in range(7)]
        assert [s.id for s in automaton.spec.states if s.accept] == ["q5"]
        assert self.moves(automaton) == [
            ("q0", "q1", ["0"]),
            ("q1", "q2", ["1"]),
            ("q2", "q3", ["0"]),
            ("q3", "q4", ["1"]),
            ("q0", "q6", ["1"]),
        ]
        assert reveal.kind == "board.reveal" and reveal.item == "dfa1"
        problems = " ".join(sentence.problems)
        assert "q4->q5" in problems and "no symbol" in problems
        assert "..." in problems

    @pytest.mark.parametrize(
        "command",
        [
            "dfa d start=q0 accept=q2 q0-0-q1 q1-1-q2",
            "dfa d start=q0 accept=q2 q0-0->q1 q1-1->q2",
            "dfa d start=q0 accept=q2 q0-0->q1, q1-1->q2",
            "dfa d start=q0 accept=q2 q0 -0-> q1 q1 -1-> q2",
            "dfa d start=q0 accept=q2 q0, q1, q2 q0-0->q1 q1-1->q2",
        ],
    )
    def test_spacing_commas_arrows_and_a_state_list_read_the_same(self, command):
        action = parse_command(command, BoardContext(specs={}))
        assert action is not None
        assert self.moves(action) == [("q0", "q1", ["0"]), ("q1", "q2", ["1"])]
        assert [s.id for s in action.spec.states] == ["q0", "q1", "q2"]

    def test_symbol_lists_and_accept_lists_take_spaces_after_commas(self):
        action = parse_command(
            "dfa d start=q0 accept=q1, q2 q0-0, 1->q1 q1-0,1-q2", BoardContext(specs={})
        )
        assert self.moves(action) == [("q0", "q1", ["0", "1"]), ("q1", "q2", ["0", "1"])]
        assert [s.id for s in action.spec.states if s.accept] == ["q1", "q2"]

    def test_an_edge_written_as_one_move_reads(self):
        ctx = BoardContext(specs={})
        parse_command("dfa d hidden start=q0 accept=q1 q0-0-q1", ctx)
        edge = parse_command("edge d q1-0,1->q1", ctx)
        assert edge is not None and edge.kind == "board.addTransition"
        assert (edge.from_, edge.to, list(edge.symbols)) == ("q1", "q1", ["0", "1"])

    def test_a_dfa_without_start_is_still_refused(self):
        assert parse_command("dfa d accept=q1 q0-0->q1", BoardContext(specs={})) is None


def test_owner_live_dfa_keeps_first_move_and_no_accept_states():
    fixture = json.loads(
        (Path(__file__).parents[4] / "packages/shared/src/beats/live-dfa-fixture.json").read_text()
    )
    [sentence] = read(fixture["tag"])
    assert len(sentence.anchors) == 1
    action = dump(sentence.anchors[0][1])
    assert action["spec"]["transitions"] == fixture["expectedTransitions"]
    assert action["spec"]["states"] == [{"id": f"q{i}"} for i in range(5)]
    assert action["reveal"] == "none"
    assert dump(BEAT_ACTION.validate_python(fixture["action"])) == action


def test_conflicting_move_keeps_its_nonconflicting_symbols():
    action = parse_command("dfa d start=q0 q0-0-q1 q0-0,1-q2", BoardContext())
    assert action is not None
    assert dump(action)["spec"]["transitions"] == [
        {"from": "q0", "to": "q1", "symbols": ["0"]},
        {"from": "q0", "to": "q2", "symbols": ["1"]},
    ]
