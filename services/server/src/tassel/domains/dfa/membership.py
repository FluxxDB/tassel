"""Evaluate the finite predicate DSL, never provider-written Python or expressions.

Provider selection and network calls belong to DeepCheck.membership. Every reader supplies the
same MembershipPredicate, and every supplied reference faces this same bounded agreement check.
"""

from collections import deque
from collections.abc import Sequence

from tassel.domains.dfa.contract import Atom, MembershipPredicate
from tassel.domains.dfa.machine import Machine

MAX_CHECK_LENGTH = 12
MAX_CHECK_WORDS = 200_000
_REQUIRED = {
    "starts_with": ("text",),
    "ends_with": ("text",),
    "contains": ("text",),
    "length_eq": ("n",),
    "length_ge": ("n",),
    "length_le": ("n",),
    "length_mod": ("m", "r"),
    "count_eq": ("symbol", "n"),
    "count_ge": ("symbol", "n"),
    "count_le": ("symbol", "n"),
    "count_mod": ("symbol", "m", "r"),
    "value_mod": ("m", "r"),
}


def validate_predicate(p: MembershipPredicate, alphabet: Sequence[str]) -> list[str]:
    problems = []
    symbols = set(alphabet)
    if any(len(symbol) != 1 for symbol in symbols):
        problems.append("alphabet symbols must be single characters")
    if not p.expressible:
        problems.append("predicate is not expressible")
    for ci, clause in enumerate(p.any_of):
        for ai, atom in enumerate(clause.all_of):
            path = f"any_of[{ci}].all_of[{ai}]"
            for field in _REQUIRED[atom.op]:
                if getattr(atom, field) is None:
                    problems.append(f"{path}: {atom.op} needs {field}")
            if atom.m is not None and atom.m < 1:
                problems.append(f"{path}: m must be at least 1")
            if (
                atom.r is not None
                and atom.m is not None
                and atom.m >= 1
                and not 0 <= atom.r < atom.m
            ):
                problems.append(f"{path}: r must be in 0..m-1")
            if atom.symbol is not None and (len(atom.symbol) != 1 or atom.symbol not in symbols):
                problems.append(f"{path}: symbol must be one character of the alphabet")
            if atom.text is not None and not set(atom.text) <= symbols:
                problems.append(f"{path}: text contains characters outside the alphabet")
            if atom.op == "value_mod" and symbols != {"0", "1"}:
                problems.append(f"{path}: value_mod needs the binary alphabet 0, 1")
    return problems


def _atom_value(atom: Atom, word: str) -> bool:
    op = atom.op
    if op == "starts_with":
        result = word.startswith(atom.text)
    elif op == "ends_with":
        result = word.endswith(atom.text)
    elif op == "contains":
        result = atom.text in word
    elif op == "value_mod":
        value = 0
        for symbol in word:
            if symbol not in "01":
                raise ValueError("value_mod needs a binary word")
            value = (value * 2 + int(symbol)) % atom.m
        result = value == atom.r
    else:
        value = len(word) if op.startswith("length_") else word.count(atom.symbol)
        if op.endswith("_eq"):
            result = value == atom.n
        elif op.endswith("_ge"):
            result = value >= atom.n
        elif op.endswith("_le"):
            result = value <= atom.n
        else:
            result = value % atom.m == atom.r
    return not result if atom.negate else result


def evaluate(p: MembershipPredicate, word: str) -> bool:
    """Evaluate a validated predicate: OR of clauses, each an AND of its atoms."""
    if not p.expressible:
        raise ValueError("predicate is not expressible")
    return any(all(_atom_value(atom, word) for atom in clause.all_of) for clause in p.any_of)


def check_length(alphabet_size: int, cap: int = MAX_CHECK_WORDS) -> int:
    if alphabet_size < 0 or cap < 1:
        raise ValueError("alphabet size must be nonnegative and the cap must include epsilon")
    total = power = 1  # epsilon counts, including for an empty alphabet
    length = 0
    for candidate in range(1, MAX_CHECK_LENGTH + 1):
        power *= alphabet_size
        if total + power > cap:
            break
        total += power
        length = candidate
    return length


def agrees(machine: Machine, p: MembershipPredicate, max_len: int) -> str | None:
    """First shortlex disagreement, carrying one DFA step per extension through the queue."""
    if not machine.deterministic:
        raise ValueError("agreement needs a deterministic machine with a start")
    if not 0 <= max_len <= check_length(len(machine.alphabet)):
        raise ValueError("requested agreement length exceeds the word budget")
    if problems := validate_predicate(p, machine.alphabet):
        raise ValueError("; ".join(problems))
    pending = deque([("", machine.start)])
    while pending:
        word, state = pending.popleft()
        if (state in machine.accepts) != evaluate(p, word):
            return word
        if len(word) < max_len:
            pending.extend(
                (word + symbol, machine.next(state, symbol)) for symbol in machine.alphabet
            )
    return None
