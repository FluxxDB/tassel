"""``pnpm eval:live [scenario...]``: scripted conversations through the real voice pipeline, with
real provider calls for the director, talker, thinker, Illustrator and Pointer, fake TTS, typed
turns (no STT), synthetic page fixtures and a hard prompt-token budget. Reports go to
``services/server/.cache/evals/<timestamp>/``.

    python -m tassel.evals.live --dry-run            # scenarios, turns, estimates; no keys
    python -m tassel.evals.live                      # the default set, real tokens
    python -m tassel.evals.live network --thinker-effort low --budget 40000
    python -m tassel.evals.live --fake smoke         # fake providers, no tokens

Provider keys come only from the server's own settings loading (``VoiceSettings.load``), which
reads the file named by ``TASSEL_VOICE_ENV_FILE``; this module never opens that file.
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

from loguru import logger

from tassel.evals.runner import DEFAULT_BUDGET, prompt_total, run_scenarios
from tassel.evals.scenario import ScenarioError, estimate_turn, load_scenarios
from tassel.evals.session import PipelineSession, with_effort
from tassel.voice.director import view_request
from tassel.voice.settings import SERVER_DIR, VoiceConfigError, VoiceSettings, resolve_mode

__all__ = ["main", "with_effort"]

EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"]
DIRECTOR_MODEL = "qwen/qwen3.8-27b"


class RefusedRun(RuntimeError):
    """A real run that can't start, with what to fix."""


def parse_args(argv):
    parser = argparse.ArgumentParser(
        prog="pnpm eval:live",
        description="Real-token evaluation of Ada, the live voice tutor.",
    )
    parser.add_argument(
        "scenarios", nargs="*", help="scenario names (default: the default set; 'all': every one)"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="list scenarios and turns; no provider call"
    )
    parser.add_argument("--fake", action="store_true", help="fake providers: no keys, no tokens")
    parser.add_argument(
        "--budget",
        type=int,
        default=DEFAULT_BUDGET,
        help=f"stop before a turn past this many prompt tokens (default {DEFAULT_BUDGET})",
    )
    parser.add_argument("--thinker-model", help="the thinker's model (default: the settings')")
    parser.add_argument("--thinker-effort", choices=EFFORTS, help="the thinker's reasoning effort")
    parser.add_argument(
        "--thinker-draw-effort", choices=EFFORTS, help="the thinker's effort for automata"
    )
    parser.add_argument(
        "--pointer-effort", choices=EFFORTS, help="the Pointer's reasoning effort (app: none)"
    )
    parser.add_argument(
        "--reply-gap",
        type=float,
        default=0,
        help="seconds she waits before each later turn, as while Ada speaks (default 0)",
    )
    parser.add_argument("--out", type=Path, help="report directory")
    parser.add_argument("--verbose", action="store_true", help="the pipeline's logs on stderr")
    return parser.parse_args(argv)


def describe(settings: VoiceSettings, args, mode: str) -> dict:
    """The settings a run used, for the report: models and efforts, never a key."""
    routed = {"openrouter": DIRECTOR_MODEL}
    return {
        "mode": mode,
        "talker": {"model": settings.llm_model if mode == "live" else "fake"},
        "director": {"model": DIRECTOR_MODEL if mode == "live" else "rules + script"},
        "thinker": {
            "model": settings.thinker_model,
            "effort": settings.thinker_effort,
            "draw_effort": settings.thinker_draw_effort,
        },
        "illustrator": {
            "provider": settings.illustrator_provider,
            "model": routed.get(settings.illustrator_provider, settings.illustrator_model),
        },
        "pointer": {
            "provider": settings.pointer_provider,
            "model": routed.get(settings.pointer_provider, settings.pointer_model),
            "effort": args.pointer_effort or "none",
        },
        "tts": "fake (tone)",
        "stt": "none (typed turns)",
        "budget": args.budget,
        "reply_gap_s": args.reply_gap,
    }


def _speech_free(settings: VoiceSettings, run_dir: Path, args) -> VoiceSettings:
    update = {
        "stt_provider": "fake",
        "tts_provider": "fake",
        "fake_tts": "tone",
        "transcript_dir": run_dir / "transcripts",
    }
    if args.thinker_model:
        update["thinker_model"] = args.thinker_model
    if args.thinker_effort:
        update["thinker_effort"] = args.thinker_effort
    if args.thinker_draw_effort:
        update["thinker_draw_effort"] = args.thinker_draw_effort
    return settings.model_copy(update=update)


def live_settings(args, run_dir: Path, *, load_settings=VoiceSettings.load, environ=os.environ):
    """The server's own voice settings with speech made fake, or RefusedRun."""
    told = environ.get("TASSEL_VOICE_ENV_FILE")
    if not told:
        raise RefusedRun(
            "TASSEL_VOICE_ENV_FILE is not set. A real run reads the provider keys through the "
            "server's settings from that file: TASSEL_VOICE_ENV_FILE=/path/to/voice.env pnpm "
            "eval:live. Use --dry-run or --fake to run without keys."
        )
    if not Path(told).is_file():
        raise RefusedRun(f"TASSEL_VOICE_ENV_FILE names a file that does not exist: {told}")
    settings = _speech_free(load_settings(), run_dir, args)
    missing = [
        name
        for name, value in (
            ("OPENROUTER_API_KEY", settings.openrouter_api_key),
            ("OPENAI_API_KEY", settings.openai_api_key),
        )
        if value is None or not value.get_secret_value().strip()
    ]
    if missing:
        raise RefusedRun(
            "The live tutor needs " + " and ".join(missing) + " in the file TASSEL_VOICE_ENV_FILE "
            "names (OpenRouter: director, talker, Illustrator; OpenAI: thinker, Pointer)."
        )
    try:
        live = resolve_mode("llm", settings) == "live"
    except VoiceConfigError as error:
        raise RefusedRun(str(error)) from None
    if not live or not settings.two_tier_enabled:
        raise RefusedRun(
            "The voice settings select fake providers (TASSEL_PROVIDERS, TASSEL_LLM_PROVIDER or "
            "TASSEL_TWO_TIER); a real run needs the live two-tier tutor."
        )
    return settings, describe(settings, args, "live")


def fake_settings(args, run_dir: Path):
    settings = _speech_free(VoiceSettings(providers="fake"), run_dir, args)
    return settings, describe(settings, args, "fake")


def dry_run(scenarios, args, out) -> None:
    grand = 0
    print(f"Budget: {args.budget:,} prompt tokens per run (estimates are rough)\n", file=out)
    for s in scenarios:
        estimates = [estimate_turn(t, i, page=s.page_at(i)) for i, t in enumerate(s.turns)]
        grand += sum(estimates)
        flag = "" if s.default else " [by name only]"
        print(
            f"{s.name}{flag}: {s.title} ({len(s.turns)} turns, estimate ~{sum(estimates):,})",
            file=out,
        )
        for i, (turn, cost) in enumerate(zip(s.turns, estimates, strict=True)):
            notes = []
            if turn.page is not None:
                notes.append(f"page {turn.page}")
            if view_request(turn.student):
                notes.append("view request")
            expect = turn.expect
            if expect.route and expect.route != "view":
                notes.append(f"route {expect.route}")
            if expect.tags:
                notes.append("tags " + ",".join(expect.tags))
            elif expect.tags == []:
                notes.append("no tags")
            if expect.marks:
                notes.append("marks " + ",".join(f"{m.type}@{m.truth}" for m in expect.marks))
            if expect.board:
                notes.append("board")
            extra = f"  [{'; '.join(notes)}]" if notes else ""
            print(f"  {i + 1:>2}. {turn.student}{extra}  ~{cost:,}", file=out)
        print("", file=out)
    print(f"Total estimate: ~{grand:,} prompt tokens", file=out)


def _progress(out):
    def on_turn(scenario, record):
        o = record.observation
        status = (
            "ok" if record.ok else "FAIL " + ", ".join(c.name for c in record.checks if not c.ok)
        )
        print(
            f"  {scenario.name} {record.index + 1}. {o.student[:60]!r}: {status} "
            f"({o.prompt_tokens:,} prompt tokens)",
            file=out,
            flush=True,
        )

    return on_turn


def main(argv=None, *, load_settings=VoiceSettings.load, out=sys.stdout) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        scenarios = load_scenarios(args.scenarios)
    except ScenarioError as error:
        print(f"eval:live: {error}", file=out)
        return 2
    if args.dry_run:
        dry_run(scenarios, args, out)
        return 0
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = args.out or SERVER_DIR / ".cache" / "evals" / stamp
    try:
        settings, described = (
            fake_settings(args, run_dir)
            if args.fake
            else live_settings(args, run_dir, load_settings=load_settings)
        )
    except RefusedRun as error:
        print(f"eval:live: {error}", file=out)
        return 2
    described["scenarios"] = [s.name for s in scenarios]
    print(f"eval:live: {len(scenarios)} scenarios, {described['mode']} providers", file=out)

    def open_session(scenario):
        return PipelineSession(scenario, settings, pointer_effort=args.pointer_effort)

    run = asyncio.run(
        run_scenarios(
            scenarios,
            open_session,
            budget=args.budget,
            on_turn=_progress(out),
            reply_gap_s=args.reply_gap,
        )
    )
    run.settings = described
    from tassel.evals.report import write_report

    json_path, md_path = write_report(run, run_dir)
    turns = [t for s in run.scenarios for t in s.turns]
    failed = [t for t in turns if not t.ok]
    errors = [s for s in run.scenarios if s.error]
    print(
        f"eval:live: {run.status}; {len(turns) - len(failed)}/{len(turns)} turns passed; "
        f"{prompt_total(run.usage):,} prompt tokens; {len(errors)} scenario errors",
        file=out,
    )
    if run.status == "budget reached":
        print(f"eval:live: budget reached; not run: {', '.join(run.skipped)}", file=out)
    print(f"eval:live: report {md_path} and {json_path}", file=out)
    return 1 if failed or errors else 0


if __name__ == "__main__":
    if "--verbose" not in sys.argv:
        # Pipecat logs every frame at DEBUG; the run prints its own progress.
        logger.remove()
        logger.add(sys.stderr, level="ERROR")
    sys.exit(main())
