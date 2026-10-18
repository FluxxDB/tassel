from copy import deepcopy

import pytest
from pydantic import ValidationError

from tassel.beats.models import DiagramSpec
from tassel.domains.network.check import check_network


def network():
    return dict(
        direction="TB",
        groups=[
            dict(id=f"g{i}", label=f"Zone {i}", sublabel=cidr)
            for i, cidr in enumerate(["10.0.0.0/26", "10.0.0.64/27", "10.0.0.96/28"])
        ],
        nodes=[
            dict(id=f"r{i}", label="Router", icon="router", group=f"g{i}", sublabel=ip)
            for i, ip in enumerate(["10.0.0.1", "10.0.0.65", "10.0.0.97"])
        ],
        edges=[],
    )


def test_valid_three_zones():
    assert check_network(DiagramSpec.model_validate(network())) is None


@pytest.mark.parametrize("ip", ["10.0.1.1", "10.0.0.0", "10.0.0.63"])
def test_unusable_host(ip):
    data = network()
    data["nodes"][0]["sublabel"] = ip
    assert check_network(DiagramSpec.model_validate(data))


def test_overlapping_subnets():
    data = network()
    data["groups"][1]["sublabel"] = "10.0.0.0/27"
    assert "overlap" in check_network(DiagramSpec.model_validate(data))


def test_gateway_requires_address():
    data = network()
    data["nodes"][0].update(label="Gateway", sublabel="unknown")
    assert check_network(DiagramSpec.model_validate(data))


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d["nodes"][0].update(group="missing"),
        lambda d: d["nodes"][0].update(id="g0"),
        lambda d: d["nodes"][0].update(icon="emoji"),
        lambda d: d["nodes"][0].update(label="x" * 41),
        lambda d: d["nodes"].extend(deepcopy(d["nodes"]) * 9),
        lambda d: d["edges"].append(
            dict(**{"from": "r0", "to": "missing"}, directed=True, style="solid")
        ),
    ],
)
def test_schema_rejects_invalid_diagrams(change):
    data = network()
    change(data)
    with pytest.raises(ValidationError):
        DiagramSpec.model_validate(data)
