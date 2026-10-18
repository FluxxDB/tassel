"""App events carried alongside RTVI captions and audio."""

from pipecat.frames.frames import VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame
from pipecat.observers.base_observer import BaseObserver, FramePushed
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.frameworks.rtvi.frames import RTVIServerMessageFrame
from pydantic import BaseModel

from tassel.voice.messages import VadEvent, envelope


class ServerEvents:
    def __init__(self, worker: PipelineWorker):
        self.worker = worker

    async def send(self, event: BaseModel) -> None:
        await self.worker.rtvi.send_server_message(envelope(event))


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
