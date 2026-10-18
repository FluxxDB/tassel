"""The run's report: ``report.json`` (everything) and ``report.md`` (for reading), per scenario and
turn: pass or fail per expectation, Ada's words, timings, and tokens per model."""

import json
from dataclasses import asdict
from pathlib import Path

from tassel.evals.checks import action_kinds
from tassel.evals.runner import RunRecord


def report_data(run: RunRecord) -> dict:
    scenarios = []
    for scenario in run.scenarios:
        turns = []
        for record in scenario.turns:
            o = record.observation
            turns.append(
                {
                    "turn": record.index + 1,
                    "student": o.student,
                    "ok": record.ok,
                    "checks": [asdict(c) for c in record.checks],
                    "spoken": o.spoken,
                    "decision": o.decision,
                    "view_request": o.view_request,
                    "stage": o.stage,
                    "tags": action_kinds(o.actions),
                    "raw_tags": o.tags,
                    "rejects": o.rejects,
                    "page": o.page,
                    "board_after": o.board_after,
                    "timings": o.timings,
                    "prompt_tokens": o.prompt_tokens,
                    "tokens": o.tokens,
                    "finished": o.finished,
                    "chat": o.chat,
                    "audio": o.audio,
                }
            )
        scenarios.append(
            {
                "name": scenario.name,
                "title": scenario.title,
                "planned_turns": scenario.planned,
                "ran_turns": len(scenario.turns),
                "passed_turns": sum(t.ok for t in scenario.turns),
                "error": scenario.error,
                "usage": scenario.usage,
                "turns": turns,
            }
        )
    return {
        "status": run.status,
        "budget": run.budget,
        "prompt_tokens": run.prompt_tokens,
        "usage": run.usage,
        "settings": run.settings,
        "skipped": run.skipped,
        "scenarios": scenarios,
    }


def _ms(value) -> str:
    return "–" if value is None else f"{value:.0f}"


def _cell(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def markdown(data: dict) -> str:
    turns = [t for s in data["scenarios"] for t in s["turns"]]
    passed = sum(t["ok"] for t in turns)
    lines = [
        "# Live tutor eval",
        "",
        f"**Status:** {data['status']} · **turns passed:** {passed}/{len(turns)} · "
        f"**prompt tokens:** {data['prompt_tokens']:,} of {data['budget']:,}",
        "",
    ]
    if data["skipped"]:
        lines += [f"Not run (budget): {', '.join(data['skipped'])}", ""]
    lines += ["## Settings", "", "```json", json.dumps(data["settings"], indent=2), "```", ""]
    lines += ["## Tokens by model", "", "| Model | Calls | Prompt | Cached | Completion |"]
    lines += ["|---|---:|---:|---:|---:|"]
    for model, e in sorted(data["usage"].get("llm", {}).items()):
        lines.append(
            f"| {model} | {e.get('calls', 0)} | {e.get('prompt', 0):,} | {e.get('cached', 0):,} "
            f"| {e.get('completion', 0):,} |"
        )
    if "usd" in data["usage"]:
        lines.append(f"\nEstimated cost: ${data['usage']['usd']:.4f}")
    lines.append("")
    for s in data["scenarios"]:
        lines += [
            f"## {s['name']}: {s['title']}",
            "",
            f"{s['passed_turns']}/{s['ran_turns']} turns passed ({s['planned_turns']} planned)",
            "",
        ]
        if s["error"]:
            lines += ["**Error:**", "", "```", s["error"].strip(), "```", ""]
        for t in s["turns"]:
            mark = "PASS" if t["ok"] else "FAIL"
            lines += [f"### {t['turn']}. {mark}: {t['student']}", ""]
            lines.append(f"- **Ada:** {t['spoken'] or '(silent)'}")
            decision = t["decision"] or {}
            route = (
                f"view request ({t['view_request']})"
                if t["view_request"]
                else f"{decision.get('route', '?')} / {decision.get('action', '?')}"
            )
            lines.append(f"- **Route:** {route}; **tags:** {', '.join(t['tags']) or 'none'}")
            if t["stage"]:
                lines.append(f"- **Stage:** {t['stage']}")
            timings = t["timings"]
            lines.append(
                "- **ms:** director {} · thinker {} · illustrator {} · pointer {} · "
                "first audio {} · turn {}".format(
                    *(
                        _ms(timings.get(k))
                        for k in (
                            "director",
                            "thinker",
                            "illustrator",
                            "pointer",
                            "first_audio",
                            "turn",
                        )
                    )
                )
            )
            tokens = ", ".join(f"{m} {e.get('prompt', 0):,}" for m, e in t["tokens"].items())
            lines.append(f"- **Prompt tokens:** {t['prompt_tokens']:,} ({tokens or 'no calls'})")
            if t["rejects"]:
                lines.append(f"- **Rejected:** {_cell(json.dumps(t['rejects'])[:400])}")
            lines += ["", "| Check | Result | Detail |", "|---|---|---|"]
            for c in t["checks"]:
                result = "ok" if c["ok"] else "**FAIL**"
                lines.append(f"| {c['name']} | {result} | {_cell(c['detail'])} |")
            lines.append("")
    return "\n".join(lines) + "\n"


def write_report(run: RunRecord, directory: Path) -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    data = report_data(run)
    json_path, md_path = directory / "report.json", directory / "report.md"
    json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(markdown(data), encoding="utf-8")
    return json_path, md_path
