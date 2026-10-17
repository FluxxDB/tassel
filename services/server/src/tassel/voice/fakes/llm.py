"""Scripted text and tool streaming through Pipecat's ordinary LLM interface."""

import asyncio
import uuid

from pipecat.frames.frames import (
    CancelWorkerFrame,
    Frame,
    FunctionCallFromLLM,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.llm_service import LLMService

from tassel.models import Lang
from tassel.voice.fakes.scenario import DROP_DIRECTIVE, FakeScenario, next_turn


class FakeLLMService(LLMService):
    def __init__(
        self,
        *,
        scenario: FakeScenario,
        lang: Lang,
        ttfb_ms: int = 250,
        chunk_words: int = 3,
        **kwargs,
    ):
        if chunk_words < 1:
            raise ValueError("chunk_words must be positive")
        super().__init__(**kwargs)
        self._scenario = scenario
        self.set_language(lang)
        self._ttfb_ms = ttfb_ms
        self._chunk_words = chunk_words

    def set_language(self, lang: Lang):
        self._script = self._scenario.langs[lang]

    def can_generate_metrics(self) -> bool:
        return True

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if not isinstance(frame, LLMContextFrame):
            await self.push_frame(frame, direction)
            return
        user_text = None
        said = []
        for message in frame.context.get_messages():
            if not isinstance(message, dict):
                continue
            content = message.get("content")
            if isinstance(content, list):
                content = " ".join(b["text"] for b in content if b.get("type") == "text")
            if not isinstance(content, str):
                continue
            if message.get("role") == "user":
                user_text = content
            elif message.get("role") == "assistant":
                said.append(content)
        if user_text == DROP_DIRECTIVE:
            await self.push_frame(
                CancelWorkerFrame(reason="scripted drop"), FrameDirection.UPSTREAM
            )
            return

        turn = next_turn(self._script, user_text, said)
        await self.push_frame(LLMFullResponseStartFrame())
        await self.start_ttfb_metrics()
        await asyncio.sleep(self._ttfb_ms / 1000)
        words = turn.say.split()
        for start in range(0, len(words), self._chunk_words):
            if start:
                await asyncio.sleep(0.03)
            else:
                await self.stop_ttfb_metrics()
            end = start + self._chunk_words
            text = " ".join(words[start:end])
            if end < len(words):
                text += " "
            await self.push_frame(LLMTextFrame(text))
        await self.run_function_calls(
            [
                FunctionCallFromLLM(
                    function_name=tool.name,
                    tool_call_id=str(uuid.uuid4()),
                    arguments=tool.arguments,
                    context=frame.context,
                )
                for tool in turn.tools
            ]
        )
        await self.push_frame(LLMFullResponseEndFrame())
