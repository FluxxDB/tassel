"""Trusted hand-written references, shipped as package resources."""

import json
from dataclasses import dataclass
from importlib.resources import files
from typing import Literal

from tassel.domains.dfa.contract import MachineSpec, ReferenceInfo
from tassel.domains.dfa.machine import Machine, machine_from_spec, to_spec
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
