from tassel.domains.dfa.machine import machine_from_spec, to_automata_dfa
from tassel.domains.dfa.reference import CATALOG, catalog_match
from tassel.domains.dfa.regex import compile_regex


def test_catalog_entries_are_complete_and_match_their_regexes():
    assert set(CATALOG) == {"starts-with-010", "ends-with-01", "contains-11", "even-zeros"}
    for key, entry in CATALOG.items():
        assert entry.id == key and entry.source == "catalog" and entry.trusted
        assert entry.title and entry.regex
        m = entry.machine
        assert all(m.moves.get((s, a)) for s in m.states for a in m.alphabet)
        assert to_automata_dfa(m) == to_automata_dfa(compile_regex(entry.regex, m.alphabet))
        info = entry.info()
        assert info.id == key and info.source == "catalog" and info.trusted
        assert info.title == entry.title and info.regex == entry.regex
        assert to_automata_dfa(machine_from_spec(info.machine)) == to_automata_dfa(m)


def test_catalog_match():
    assert catalog_match(compile_regex("010(0|1)*", "01")).id == "starts-with-010"
    assert catalog_match(compile_regex("(0|1)*0", "01")) is None
    assert catalog_match(compile_regex("010Σ*", "012")) is None
