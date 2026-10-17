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
