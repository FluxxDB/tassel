"""Tools advertised to live and fake tutors; the bot owns their handlers."""

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema

SHOW_STAGE = FunctionSchema(
    name="show_stage",
    description="Request a paper, board or split view to support the explanation.",
    properties={"view": {"type": "string", "enum": ["paper", "board", "split"]}},
    required=["view"],
)
SET_LANGUAGE = FunctionSchema(
    name="set_language",
    description="Switch the session language when the student asks.",
    properties={"language": {"type": "string", "enum": ["en", "es", "ko"]}},
    required=["language"],
)
TOOLS = ToolsSchema(standard_tools=[SHOW_STAGE, SET_LANGUAGE])
# The director owns views; a talker show_stage call triggered a second, unplanned reply.
TALKER_TOOLS = ToolsSchema(standard_tools=[SET_LANGUAGE])

DRAW_SCREEN = FunctionSchema(
    name="draw_screen",
    description="Point at the student's currently shared digital assignment. "
    "Use coordinates of the ENTIRE attached image: x = pixel_x / image width, "
    "y = pixel_y / image height (0 to 1, origin top-left, y increases downward). "
    "Do not use coordinates relative to the question, a crop, a window, or a square image. "
    "Use the exact frame_id "
    "from its caption. Never guess a frame ID.",
    properties={
        "frame_id": {"type": "string"},
        "kind": {"type": "string", "enum": ["pointer", "circle", "underline", "arrow"]},
        "points": {
            "description": "pointer: exactly one point at the target. "
            "circle: exactly two opposite corners (top-left and bottom-right) of the "
            "target's bounding box, NOT center and radius. "
            "underline: exactly two endpoints of a line just below the text, "
            "left to right at the same y. arrow: exactly two points, tail then tip. "
            "Locate the target in the current image before drawing; omit the call if uncertain.",
            "type": "array",
            "minItems": 1,
            "maxItems": 2,
            "items": {
                "type": "object",
                "properties": {
                    "x": {"type": "number", "minimum": 0, "maximum": 1},
                    "y": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["x", "y"],
                "additionalProperties": False,
            },
        },
    },
    required=["frame_id", "kind", "points"],
)
SCREEN_TOOLS = ToolsSchema(standard_tools=[SHOW_STAGE, SET_LANGUAGE, DRAW_SCREEN])
