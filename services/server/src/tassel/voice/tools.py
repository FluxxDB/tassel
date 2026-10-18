"""Tools advertised to live and fake tutors; the bot owns their handlers."""

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema

from tassel.beats.models import BoardAutomaton, BoardDiagram, BoardNote
from tassel.screen.api import ScreenPrimitive


def inline_schema(model):
    schema = model.model_json_schema()
    definitions = schema.pop("$defs", {})

    def expand(value):
        if isinstance(value, dict):
            if "$ref" in value:
                return expand(definitions[value["$ref"].rsplit("/", 1)[-1]])
            return {key: expand(item) for key, item in value.items()}
        if isinstance(value, list):
            return [expand(item) for item in value]
        return value

    return expand(schema)


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
        "target": {
            "type": "string",
            ("description"): (
                "Required when marking an EXISTING screen object: describe its "
                "visible label and context. A dedicated pointer resolves its "
                "location from the current image. Omit only when creating new "
                "artwork or text in empty space."
            ),
        },
        "color": {
            "type": "string",
            "enum": ["violet", "red", "blue", "green", "orange", "black", "white"],
        },
        "kind": {
            "type": "string",
            "enum": ["pointer", "circle", "underline", "arrow", "rectangle", "text", "freehand"],
        },
        "text": {
            "type": "string",
            "maxLength": 500,
            "description": "Required for kind=text: the exact text to write, "
            "using newline for line breaks.",
        },
        "points": {
            "description": "Omit points when target is supplied; the dedicated pointer locates it. "
            "pointer: exactly one point at the target. "
            "circle: exactly two opposite corners (top-left and bottom-right) of the "
            "target's bounding box, NOT center and radius. "
            "underline: exactly two endpoints of a line just below the text, "
            "left to right at the same y. arrow: exactly two points, tail then tip. "
            "rectangle: two opposite corners. text: one top-left anchor plus the text field. "
            "freehand: two to 512 successive path points. "
            "Locate the requested target in the CURRENT image before drawing. Cross-check "
            "its visible label and surrounding content; do not mark a similarly placed app "
            "or a target from earlier conversation. Omit the call if uncertain.",
            "type": "array",
            "minItems": 1,
            "maxItems": 512,
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
    required=["frame_id", "kind"],
)
EDIT_SCREEN = FunctionSchema(
    name="edit_screen",
    description=(
        "List, remove, move, recolor or clear existing overlay objects by "
        "their persistent IDs. Does NOT require a new screenshot. Use this"
        " when verbally asked to remove a circle; objects may be invisible"
        " in the captured desktop. Never claim an edit succeeded before "
        "ok=true."
    ),
    properties={
        "operation": {"type": "string", "enum": ["list", "remove", "move", "recolor", "clear"]},
        "ids": {"type": "array", "items": {"type": "string"}, "maxItems": 300},
        "dx": {"type": "number", "minimum": -1, "maximum": 1},
        "dy": {"type": "number", "minimum": -1, "maximum": 1},
        "color": {
            "type": "string",
            "enum": ["violet", "red", "blue", "green", "orange", "black", "white"],
        },
    },
    required=["operation"],
)
DRAW_SCREEN_ILLUSTRATION = FunctionSchema(
    name="draw_screen_illustration",
    description=(
        "For existing screen objects, circle/underline/point with draw_screen.target instead. "
        "This tool creates NEW artwork. Draw an illustration directly on the transparent screen "
        "whiteboard. Use multiple freehand paths, geometric shapes, arrows"
        " and written text in ONE batch. Draw the actual requested "
        "subject, not a graph of labeled boxes. Each stroke uses "
        "full-image normalized coordinates. Purple is default; honor "
        "requested colors. Use draw_screen_board for a DFA or structured "
        "graph instead."
    ),
    properties={
        "frame_id": {"type": "string"},
        "strokes": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "items": inline_schema(ScreenPrimitive),
        },
    },
    required=["frame_id", "strokes"],
)
DRAW_SCREEN_BOARD = FunctionSchema(
    name="draw_screen_board",
    description=(
        "Draw or update a DFA/NFA, structured diagram or note using the "
        "SAME checked whiteboard engine as the regular board. action is a "
        "board.automaton, board.diagram or board.note with a stable item ID. "
        'DFA example action: {"kind":"board.automaton","item":"dfa1",'
        '"spec":{"kind":"dfa","states":[{"id":"q0","accept":true}],'
        '"start":"q0","transitions":[{"from":"q0","to":"q0","symbols":["0","1"]}]}}. '
        "IDs are strings: item uses letters/digits/underscore/hyphen (1-64 characters); "
        "state IDs use letters/digits/underscore (1-16), starting with a letter or digit. "
        "Each transition symbol is a separate string (1-4 characters, no spaces or commas). "
        "region is its full-screenshot"
        " normalized placement. Free illustrations should use "
        "draw_screen_illustration instead."
    ),
    properties={
        "frame_id": {"type": "string"},
        "action": {
            "anyOf": [inline_schema(model) for model in (BoardAutomaton, BoardDiagram, BoardNote)]
        },
        "region": {
            "type": "object",
            "properties": {
                k: {"type": "number", "minimum": 0, "maximum": 1} for k in ("x", "y", "w", "h")
            },
            "required": ["x", "y", "w", "h"],
        },
        "color": {
            "type": "string",
            "enum": ["violet", "red", "blue", "green", "orange", "black", "white"],
        },
    },
    required=["frame_id", "action", "region"],
)
SCREEN_TOOLS = ToolsSchema(
    standard_tools=[
        SHOW_STAGE,
        SET_LANGUAGE,
        DRAW_SCREEN,
        EDIT_SCREEN,
        DRAW_SCREEN_ILLUSTRATION,
        DRAW_SCREEN_BOARD,
    ]
)
