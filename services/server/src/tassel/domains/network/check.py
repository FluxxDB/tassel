"""Deterministic IPv4 checks for diagrams with CIDR-labelled groups."""

import re
from ipaddress import IPv4Address, IPv4Network

from tassel.beats.models import DiagramSpec

CIDR = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b")
ROUTER = re.compile(r"router|gateway|enrutador|puerta de enlace|라우터|게이트웨이", re.I)


def check_network(spec: DiagramSpec) -> str | None:
    networks = {}
    for group in spec.groups:
        match = CIDR.search(group.sublabel or "")
        if not match:
            continue
        try:
            network = IPv4Network(match.group())
        except ValueError:
            return f"Group {group.id} needs a valid network CIDR."
        if any(network.overlaps(other) for other in networks.values()):
            return f"Group {group.id}: subnet CIDRs must not overlap."
        networks[group.id] = network
    for node in spec.nodes:
        network = networks.get(node.group)
        if network is None:
            continue
        try:
            address = IPv4Address(node.sublabel or "")
        except ValueError:
            if node.icon == "router" or ROUTER.search(node.label):
                return f"Router/gateway {node.id} needs a usable IPv4 host in {network}."
            continue
        if address not in network or address in (
            network.network_address,
            network.broadcast_address,
        ):
            return f"Node {node.id}: {address} is not a usable host in {network}."
    return None
