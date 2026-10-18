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
    "Use normalized image coordinates (0 to 1) and the exact frame_id "
    "from its caption. Never guess a frame ID.",
    properties={
        "frame_id": {"type": "string"},
        "kind": {"type": "string", "enum": ["pointer", "circle", "underline", "arrow"]},
        "points": {
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
