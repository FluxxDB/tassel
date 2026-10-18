# Decision layer: a director, a vision gate and an action checker

Date: 2026-10-17, 23:10. Status: owner direction in chat. It extends `2026-10-17-two-tier-tutor.md`.

## Why (from the owner's fourth live test and its server log)
- **"Hold the page still" is a misleading error.** Ada blamed the student for a shaky page when the page image had actually failed to upload: about 85–90 KB, `APIConnectionError`, then "retrying without image". The fallback prompt invited the wrong excuse.
- **The paper was always attached.** Every turn carried a page image, even while the student was talking about the whiteboard, so Ada complained about the paper when she shouldn't have looked at it.
- **Snapshots ran too often.** Frame uploads went about every 5 s, and some were refused with 429.
- **The LLM was making choices that rules or small models should make.** Owner: "There should be way more layers of decision models to guide choices that the llm is making (that it shouldn't be making)": which view to show, whether to look at the paper, Qwen vs astra, whether and where to draw.

## Layers
1. **Director.** Runs once per student turn, starting the moment the final transcript arrives. It's a fast structured-output model: Qwen 3.8 on Cerebras, with a strict JSON schema and a budget of about 300 ms. If it times out or fails, deterministic rules decide instead. Its output:
   - `focus`: `paper` | `board` | `split` | `none` (the default is the current stage). Ada's view changes follow it, so the LLM no longer picks views.
   - `needs_vision`: true only when the turn is about the paper, or the page changed meaningfully since Ada last saw it.
   - `route`: `talker` (Qwen) | `thinker` (astra), from complexity: drawing, marking, diagnosing, "why", multi-step reasoning.
   - `action`: `none` | `explain` | `draw_board` | `mark_paper` | `trace`. "On my paper" or "camera" means `mark_paper`; "on the board" or "whiteboard" means `draw_board`.
   - `refers_to`: `paper` | `board` | `conversation`. When it's `board`, the turn carries no page image, and the context carries the board's current items.

   Its inputs are the transcript, the last 4 turns, the stage state (current view, board items, whether a snapshot is frozen) and the page-change signal. Every decision is logged to the dev transcript.
2. **Vision gate.**
   - Capture only when `needs_vision` is true, or on a meaningful page change while the focus is `paper` or `split`.
   - On capture, take a short burst of 3 frames over about 300 ms and keep the sharpest, by Laplacian variance. Reject frames below a sharpness floor (motion), and retry once after 300 ms.
   - Stop the per-turn upload when `needs_vision` is false. The detector's ink uploads are rate-limited to at most one per 10 s unless the change is large.
   - Fail softly: when an image can't be delivered, Ada uses her latest page notes (the last brief or reading) and doesn't mention the failure unless the student asked about the page. Then she says plainly that her view didn't come through, never that the student moved.
   - Keep the image under 60 KB, which got through 8/8 on this network; 90 KB failed often.
3. **Thinker.** gpt-6-astra (low) writes guidance briefs, as the two-tier spec says, but only when the director routes the turn to it.
4. **Action checker.** Deterministic, before anything is drawn:
   - tags parse;
   - the action matches the director's `action` (no board drawing on a `mark_paper` turn, and the reverse);
   - board DFAs are checked with P4's exact verifier (`services/server/src/tassel/domains/dfa/`, merged from claude/p4-automata-vision) against the language in the brief, when there is one. A wrong DFA is never drawn: the thinker is asked once to repair it, otherwise the drawing is skipped.
   - board drawings stay small.
5. **Later (P4 converge):** a proactive-interruption gate (P4 Task 10's decision gate plus Task 5's policy) decides when Ada speaks up unprompted about new ink.

## Tests
- Director: the schema, the rules fallback on timeout, and routing for paper vs board vs conversation turns, including "draw it on my paper" vs "draw it on the board".
- Vision gate: no image on board turns, sharpest-frame selection, the upload rate limit, and a soft failure with no blame line.
- Action checker: a mismatched action is dropped, and a wrong DFA isn't drawn.
- Live checks (main): the owner's clip and the board-talk scenario.
