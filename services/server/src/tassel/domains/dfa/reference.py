"""Trusted hand-written references, shipped as package resources."""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from hashlib import sha256
from importlib.resources import files
from typing import Literal

from tassel.domains.dfa.contract import MachineSpec, MembershipPredicate, ReferenceInfo
from tassel.domains.dfa.machine import Machine, machine_from_spec, to_spec
from tassel.domains.dfa.membership import agrees, check_length, validate_predicate
from tassel.domains.dfa.regex import RegexError, compile_regex
from tassel.domains.dfa.search import shortest_counterexample


@dataclass(frozen=True)
class Reference:
    id: str
    title: str | None
    machine: Machine
    regex: str | None
    source: Literal["catalog", "llm-checked", "llm-unchecked"]
    trusted: bool

    def info(self) -> ReferenceInfo:
        return ReferenceInfo(
            id=self.id,
            title=self.title,
            machine=to_spec(self.machine),
            regex=self.regex,
            source=self.source,
            trusted=self.trusted,
        )


def _load_catalog() -> dict[str, Reference]:
    catalog = {}
    for resource in sorted(
        files("tassel.domains.dfa").joinpath("catalog").iterdir(), key=lambda p: p.name
    ):
        if resource.name.endswith(".json"):
            data = json.loads(resource.read_text(encoding="utf-8"))
            identifier, title, regex = data.pop("id"), data.pop("title"), data.pop("regex")
            catalog[identifier] = Reference(
                identifier,
                title,
                machine_from_spec(MachineSpec.model_validate(data)),
                regex,
                "catalog",
                True,
            )
    return catalog


CATALOG: dict[str, Reference] = _load_catalog()


def catalog_match(machine: Machine) -> Reference | None:
    for reference in CATALOG.values():
        if (
            machine.alphabet == reference.machine.alphabet
            and shortest_counterexample(machine, reference.machine) is None
        ):
            return reference
    return None


def resolve_reference(
    *,
    regex: str | None,
    alphabet: Sequence[str],
    predicate: MembershipPredicate | None,
    title: str | None,
) -> Reference | None:
    """Resolve a target; provider-independent agreement is evidence bounded by check_length."""
    if regex is None:
        return None
    try:
        machine = compile_regex(regex, alphabet)
    except RegexError:
        return None
    if catalog := catalog_match(machine):
        return catalog
    trusted = (
        predicate is not None
        and not validate_predicate(predicate, machine.alphabet)
        and agrees(machine, predicate, check_length(len(machine.alphabet))) is None
    )
    return Reference(
        id="llm:" + sha256(regex.encode("utf-8")).hexdigest()[:8],
        title=title,
        machine=machine,
        regex=regex,
        source="llm-checked" if trusted else "llm-unchecked",
        trusted=trusted,
    )
