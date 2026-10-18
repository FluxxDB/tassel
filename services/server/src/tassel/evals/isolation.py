"""The memory isolation playtest: one session names a DFA and a 10.0.0.0/24 network and states
how she likes to be taught; its memory is extracted the way leaving a session extracts it; then
a new session says hi and "what should we work on?", and Ada must mention nothing from the
first. Two scenarios (isolation-first, isolation-second) through the live eval harness, under
one prompt-token budget, with the report under services/server/.cache/evals/<timestamp>/.

    TASSEL_VOICE_ENV_FILE=... python -m tassel.evals.isolation --budget 15000
    python -m tassel.evals.isolation --fake   # no keys, no tokens: the harness itself
"""

import asyncio
import sys
from datetime import datetime

from loguru import logger

from tassel.evals.live import SERVER_DIR, fake_settings, live_settings, parse_args
from tassel.evals.runner import RunRecord, _merge, run_scenarios
from tassel.evals.scenario import load_scenarios
from tassel.evals.session import PipelineSession
from tassel.learner_memory import extract_notes, keep_preferences, transcript_text
from tassel.voice.settings import VoiceSettings

# What one extraction call costs in prompt tokens, counted against the budget by estimate.
EXTRACTION_TOKENS = 1500


async def extracted_memory(settings: VoiceSettings, session: PipelineSession) -> str:
    """The first session's memory as leaving it would store it: extracted, then filtered to
    preference lines. Fake providers extract nothing, so the filter gets the transcript."""
    messages, _ = session.ctx.memory.recall(session.ctx.session_id)
    transcript = transcript_text(messages)
    notes = await extract_notes(settings, "", transcript)
    if notes is None:
        notes = "\n".join(line.split(": ", 1)[1] for line in transcript.splitlines())
    return keep_preferences(notes)


async def run(settings: VoiceSettings, args, out) -> RunRecord:
    first, second = load_scenarios(["isolation-first", "isolation-second"])
    combined = RunRecord(budget=args.budget)
    sessions: list[PipelineSession] = []

    def open_first(scenario):
        session = PipelineSession(scenario, settings, pointer_effort=args.pointer_effort)
        sessions.append(session)
        return session

    one = await run_scenarios([first], open_first, budget=args.budget)
    combined.scenarios += one.scenarios
    _merge(combined.usage, one.usage)
    spent = one.prompt_tokens
    if one.status != "complete" or not sessions:
        combined.status, combined.skipped = one.status, one.skipped + ["isolation-second"]
        return combined
    memory = await extracted_memory(settings, sessions[0])
    spent += EXTRACTION_TOKENS
    print(
        f"isolation: memory after the first session ({len(memory.splitlines())} lines):", file=out
    )
    for line in memory.splitlines():
        print(f"  - {line}", file=out)
    leaked = [w for w in ("dfa", "10.0.0", "subnet", "network", "binary") if w in memory.lower()]
    if leaked:
        print(f"isolation: the memory still holds content: {leaked}", file=out)

    def open_second(scenario):
        return PipelineSession(
            scenario, settings, pointer_effort=args.pointer_effort, memory=memory
        )

    two = await run_scenarios([second], open_second, budget=max(args.budget - spent, 0))
    combined.scenarios += two.scenarios
    combined.skipped += two.skipped
    combined.status = two.status
    _merge(combined.usage, two.usage)
    combined.prompt_tokens = spent + two.prompt_tokens
    combined.settings = {"memory_leaked": leaked, "memory_lines": len(memory.splitlines())}
    return combined


def main(argv=None, *, out=sys.stdout) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = args.out or SERVER_DIR / ".cache" / "evals" / f"{stamp}-isolation"
    settings, described = (
        fake_settings(args, run_dir) if args.fake else live_settings(args, run_dir)
    )
    record = asyncio.run(run(settings, args, out))
    record.settings = {**described, **record.settings}
    from tassel.evals.report import write_report

    json_path, md_path = write_report(record, run_dir)
    turns = [t for s in record.scenarios for t in s.turns]
    for scenario in record.scenarios:
        for turn in scenario.turns:
            said = turn.observation.spoken.replace("\n", " ")
            print(f"[{scenario.name} {turn.index + 1}] Ada: {said}", file=out)
            for check in turn.checks:
                if not check.ok:
                    print(f"    FAIL {check.name}: {check.detail}", file=out)
    failed = [t for t in turns if not t.ok]
    print(
        f"isolation: {record.status}; {len(turns) - len(failed)}/{len(turns)} turns passed; "
        f"{record.prompt_tokens:,} prompt tokens (extraction counted as {EXTRACTION_TOKENS:,}); "
        f"report {md_path}",
        file=out,
    )
    return 1 if failed or record.settings.get("memory_leaked") else 0


if __name__ == "__main__":
    if "--verbose" not in sys.argv:
        logger.remove()
        logger.add(sys.stderr, level="ERROR")
    sys.exit(main())
