"""Expose Flux's partial transcripts as ordinary Pipecat caption frames."""

from pipecat.frames.frames import InterimTranscriptionFrame
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.utils.time import time_now_iso8601


def attach_flux_interims(stt: DeepgramFluxSTTService) -> None:
    async def interim(service, transcript: str):
        if transcript.strip():
            await service.push_frame(InterimTranscriptionFrame(transcript, "", time_now_iso8601()))

    stt.add_event_handler("on_start_of_turn", interim)
    stt.add_event_handler("on_update", interim)
