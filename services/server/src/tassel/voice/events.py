"""App events carried alongside RTVI captions and audio."""

from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
from pipecat.observers.base_observer import BaseObserver, FramePushed
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame
from pydantic import BaseModel

from tassel.voice.messages import VadEvent, envelope


class ServerEvents:
    def __init__(self, worker: PipelineWorker | None = None):
        self.worker = worker
        self.screen = None

    async def send(self, event: BaseModel) -> None:
        assert self.worker is not None, "ServerEvents must be bound before the pipeline starts"
        data = envelope(event)
        if self.screen is not None and self.screen.source:
            data["screen_epoch"] = self.screen.epoch
        await self.worker.rtvi.send_server_message(data)


class VadForwarder(BaseObserver):
    def __init__(self, worker: PipelineWorker):
        super().__init__(observe_every_push=False)
        self.worker = worker

    async def on_push_frame(self, data: FramePushed):
        if data.first_push and isinstance(
            data.frame, (VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame)
        ):
            await self.worker.queue_frame(
                RTVIServerMessageFrame(
                    data=envelope(
                        VadEvent(speaking=isinstance(data.frame, VADUserStartedSpeakingFrame))
                    )
                )
            )
