"""Independent automata-lib oracle over 300 seeded pairs of partial DFAs."""

import random

from tassel.domains.dfa.machine import Machine, to_automata_dfa
from tassel.domains.dfa.search import shortest_counterexample


def random_machine(rng):
    states = tuple(f"q{i}" for i in range(rng.randint(1, 5)))
    return Machine(
        states,
        ("0", "1"),
        states[0],
        frozenset(s for s in states if rng.choice([True, False])),
        {
            (s, a): frozenset({rng.choice(states)})
            for s in states
            for a in ("0", "1")
            if rng.random() < 0.75
        },
    )


def test_300_seeded_pairs_against_automata_lib():
    rng = random.Random(7)
    for case in range(300):
        a, b = random_machine(rng), random_machine(rng)
        oracle_a, oracle_b = to_automata_dfa(a), to_automata_dfa(b)
        result = shortest_counterexample(a, b)
        assert (result is None) == (oracle_a == oracle_b), case
        if result is not None:
            word, direction = result
            assert oracle_a.accepts_input(word) != oracle_b.accepts_input(word), case
            assert direction == (
                "false_accept" if oracle_a.accepts_input(word) else "false_reject"
            ), case
            difference = oracle_a.symmetric_difference(oracle_b)
            assert len(word) == difference.minimum_word_length(), case
            assert word == next(difference.words_of_length(len(word))), case
