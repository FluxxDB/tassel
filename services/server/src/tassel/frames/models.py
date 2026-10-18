"""The frame model shared by the API and the ``frames`` table. The app's TypeScript types come
from it.

Coordinates (P4 and P5 depend on these conventions):
- A ``Point`` is in pixels of the uploaded full JPEG; a ``page_quad`` is TL, TR, BR, BL.
- Page coordinates are 0–1 from the flattened page's top-left. ``crop_rect`` uses them.
- ``CellMask.cells`` are ``[col, row]`` pairs on the flattened page's grid.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

FrameReason = Literal["ink", "page"]
# What made the app send it: its change detector, or the server asking for a turn's page.
FrameTrigger = Literal["detector", "turn"]
PaperSourceKind = Literal["deskview-helper", "window-capture", "fake-clip", "screen"]

GRID_MAX = 200  # cells per side of the page grid
MASK_CELLS_MAX = 40_000  # GRID_MAX squared
PAGE_SLACK = 1e-6  # rounding allowed past the page's edge


class _Exact(BaseModel):
    # No unknown fields, and only finite numbers: the database's JSON can't hold NaN.
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Point(_Exact):
    """A point in pixels of the full JPEG."""

    x: float = Field(ge=0)
    y: float = Field(ge=0)


class NormRect(_Exact):
    """A rectangle in page coordinates, inside the page."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1)
    h: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def _inside_the_page(self) -> "NormRect":
        if self.x + self.w > 1 + PAGE_SLACK or self.y + self.h > 1 + PAGE_SLACK:
            raise ValueError("the rectangle must end inside the page: x + w and y + h <= 1")
        return self


class CellMask(_Exact):
    """The changed cells of the flattened page's grid, as ``[col, row]`` pairs."""

    cols: int = Field(ge=1, le=GRID_MAX)
    rows: int = Field(ge=1, le=GRID_MAX)
    cells: list[tuple[int, int]] = Field(max_length=MASK_CELLS_MAX)

    @model_validator(mode="after")
    def _cells_on_the_grid(self) -> "CellMask":
        for col, row in self.cells:
            if not (0 <= col < self.cols and 0 <= row < self.rows):
                raise ValueError(f"cell [{col}, {row}] is off the {self.cols} x {self.rows} grid")
        return self


class DetectorInfo(_Exact):
    """What the detector counted when it chose the frame, and which rules it ran."""

    changed_cells: int = Field(ge=0)
    ink_pixels: int = Field(ge=0)
    erase_pixels: int = Field(ge=0)
    version: str = Field(max_length=20)


class FrameMeta(_Exact):
    """The upload's ``meta`` part. Every field is sent; the nullable ones may be ``null``."""

    reason: FrameReason
    source: PaperSourceKind
    captured_at: AwareDatetime
    page_found: bool
    page_quad: Annotated[list[Point], Field(min_length=4, max_length=4)] | None
    crop_rect: NormRect | None
    mask: CellMask | None
    detector: DetectorInfo
    trigger: FrameTrigger = "detector"

    @model_validator(mode="after")
    def _ink_says_where(self) -> "FrameMeta":
        # The upload route also requires an ink frame's crop part.
        if self.reason == "ink" and (self.mask is None or self.crop_rect is None):
            raise ValueError("an ink frame needs its mask and crop_rect")
        return self


class FrameOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    seq: int
    reason: FrameReason
    source: PaperSourceKind
    captured_at: datetime
    created_at: datetime
    width: int  # of the full JPEG, read from its SOF marker
    height: int
    has_crop: bool
    bytes: int  # the full JPEG's size
    page_found: bool
    page_quad: list[Point] | None
    crop_rect: NormRect | None
    mask: CellMask | None
    trigger: FrameTrigger


class FrameList(BaseModel):
    items: list[FrameOut]
