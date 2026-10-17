"""FrameMeta, the upload's `meta` part, and the example that the server and the app both test."""

import json
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from tassel.frames.models import CellMask, DetectorInfo, FrameMeta, NormRect, Point


def test_frame_meta_example_validates(ink_meta):
    # As the API reads it: JSON text in a form field.
    meta = FrameMeta.model_validate_json(json.dumps(ink_meta))
    assert (meta.reason, meta.source, meta.page_found) == ("ink", "fake-clip", True)
    assert meta.captured_at == datetime(2026, 10, 17, 14, 32, 5, 120_000, tzinfo=UTC)
    corners = [(240, 120), (1040, 132), (1032, 750), (232, 738)]  # TL, TR, BR, BL
    assert meta.page_quad == [Point(x=x, y=y) for x, y in corners]
    assert meta.crop_rect == NormRect(x=0.1, y=0.2, w=0.3, h=0.25)
    # 38 rows: Letter's 618 px short side, floored to a multiple of 16 (608), in 16 px cells.
    assert meta.mask == CellMask(cols=50, rows=38, cells=[(5, 12), (6, 12)])
    assert meta.detector == DetectorInfo(
        changed_cells=2, ink_pixels=31, erase_pixels=0, version="p3.1"
    )


def invalid(ink_meta, **changes) -> bool:
    try:
        FrameMeta.model_validate({**ink_meta, **changes})
    except ValidationError:
        return True
    return False


def test_captured_at_needs_a_time_zone(ink_meta):
    assert invalid(ink_meta, captured_at="2026-10-17T14:32:05.120")


@pytest.mark.parametrize("missing", ["mask", "crop_rect"])
def test_an_ink_frame_needs_its_mask_and_crop_rect(ink_meta, missing):
    assert invalid(ink_meta, **{missing: None})
    assert not invalid(ink_meta, reason="page", **{missing: None})


def test_every_field_is_sent_even_when_null(ink_meta):
    page = {**ink_meta, "reason": "page"}
    del page["mask"]
    assert invalid(page)


def test_crop_rect_stays_on_the_page_with_a_little_slack():
    NormRect(x=0.7, y=0.75, w=0.3 + 5e-7, h=0.25)
    with pytest.raises(ValidationError):
        NormRect(x=0.7, y=0.0, w=0.31, h=0.25)
    with pytest.raises(ValidationError):
        NormRect(x=0.0, y=0.8, w=0.5, h=0.21)
    with pytest.raises(ValidationError):
        NormRect(x=-0.1, y=0.0, w=0.5, h=0.5)


@pytest.mark.parametrize(
    "mask",
    [
        {"cols": 0, "rows": 38, "cells": []},
        {"cols": 201, "rows": 38, "cells": []},
        {"cols": 50, "rows": 38, "cells": [[50, 0]]},
        {"cols": 50, "rows": 38, "cells": [[0, 38]]},
        {"cols": 50, "rows": 38, "cells": [[-1, 0]]},
        {"cols": 200, "rows": 200, "cells": [[0, 0]] * 40_001},
    ],
)
def test_mask_grid_and_cells_stay_in_range(mask):
    with pytest.raises(ValidationError):
        CellMask.model_validate(mask)


def test_the_largest_mask_fits():
    every_cell = [(col, row) for row in range(200) for col in range(200)]
    assert len(CellMask(cols=200, rows=200, cells=every_cell).cells) == 40_000


def test_detector_counts_and_version_are_bounded():
    DetectorInfo(changed_cells=0, ink_pixels=0, erase_pixels=0, version="p" * 20)
    with pytest.raises(ValidationError):
        DetectorInfo(changed_cells=-1, ink_pixels=0, erase_pixels=0, version="p3.1")
    with pytest.raises(ValidationError):
        DetectorInfo(changed_cells=0, ink_pixels=0, erase_pixels=0, version="p" * 21)


@pytest.mark.parametrize("value", [-1.0, float("inf"), float("nan")])
def test_points_are_finite_pixels(value):
    # NaN and infinity would also fail later, as JSON the database can't store.
    with pytest.raises(ValidationError):
        Point(x=value, y=0)
