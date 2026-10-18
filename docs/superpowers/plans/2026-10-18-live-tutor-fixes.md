# Live tutor fixes and real-token testing (owner's live tests, 2026-10-18)

Evidence: dev transcripts `.cache/live/transcripts/{767b954e,eb3eeab4,2de450e6}.jsonl` in the
live checkout. Already fixed on claude/live 234b64e: one reply per thinker turn, no spoken
[brackets], draw fallback, [[undo]], no bare [[clear]], [[underline]], empty-board snapshot.

## Root causes found

| Owner's issue | Root cause | Where |
|---|---|---|
| Old requests come back ("removing 3 PCs") on unrelated turns | The talker gets the thinker's latest brief as raw JSON in its tutor notes for 5 min: its spoken `say` and its board tags (`[[undo]]`). Its rules say "use the latest tutor notes… to answer", so it repeats the line and re-emits the tag (2de450e6 at 197.7 s, 212 s). | `thinker.py` `_notes_context`, `prompts.py` TALKER_RULES |
| Can't switch layouts by voice | `view_request()` misses common phrasings ("switch the board to full screen", "desk view, please", "go back desk view", "desk view full screen"); on those turns the talker then claims a switch it can't make. A recognised request still runs the talker, which once repeated a stale line instead of acknowledging. | `director.py` `view_request`, `bot.py` |
| Forgets board elements after 1–2 turns | Diagrams change only through the Illustrator, but the thinker invents `[[add net pc7 …]]` / `[[node …]]` (automaton-only or nonexistent verbs), which the checker rejects. "Add them back" after an undo has nothing to work from: removed items vanish from what the thinker sees, and the fallback sends only her words to the Illustrator, which redraws the same diagram while Ada says "Here it is." | `prompts.py` board rules, `thinker.py` fallback, `beats/markup.py` history |
| Can't draw on the camera view | Set-of-Mark labels are dropped above 12 % of the page width, so a handwritten line like "10.0.0.0/24" never gets a marker; the thinker can't target it and says "I'll look again" (a promise it never keeps). | `vision/marks.py` LABEL_MAX_SIDE, pointer |
| Paper changes vs. slight movement and her hand | The change detector diffs frames without aligning the page or masking the hand, so movement reads as change and a hand over the ink hides or fakes it. | `apps/desktop/src/renderer/src/paper/detector/**` |

## Workstreams

**A. Talker, views and board memory (this session; voice + beats only).**
1. Tutor notes for the talker carry intent, diagnosis, followups and a plain "already said / already done" summary; never the brief's `say` or tags. Test: a stale brief's say and tags are absent from the talker's context; a talker `[[undo]]` is rejected.
2. `view_request()` covers the missed phrasings (a view noun with full screen; "go back (to)? X"; a short utterance that is just a view name) with the transcripts' lines as cases; a recognised request is answered with a fixed localized line ("Here's your paper.") and no model call.
3. Thinker rules: a diagram changes only through `draw`; `[[add]]` is for automata. The draw fallback sends the brief's own plan with her words; an Illustrator result equal to the current diagram is "couldn't draw", not "Here it is."
4. `[[redo]]` re-applies what `[[undo]]` took back, and Board items list what the last undo or clear removed, so "add them back" works.
5. No promises it can't keep ("I'll look again", "let me check"): rules plus a test on the prompt.

**B. Real-token eval harness (own session; new files only).** `pnpm eval:live` runs scripted conversations through the real pipeline (director, talker, thinker, Illustrator, Pointer; TTS fake, typed turns so no STT), with fixture pages (never a real camera frame) and a hard token budget that stops the run. Each turn asserts outcomes, not wording: stage events, tag kinds, board items before/after, forbidden phrases (stale lines, "hang on", unkept promises). Scenarios cover every drawing function: automaton, network diagram, edit/add, undo/redo, clear one item, paper circle/underline/callout on handwriting, trace, notes, and every view request. Writes a JSON + Markdown report. Runs once after A and once after C; about 150k tokens per full run, mostly cached.

**C. Marks on her handwriting (own session; vision).** Text-line labels in `marks.py` (wide, short ink groups that aren't arrows: aspect, density, line fit), split long lines at gaps, and a box fallback when no marker fits. Fixture pages with handwritten IPs and labels; underline and circle land within tolerance.

**D. Paper change detection (own session; desktop paper detector).** Register each frame to the reference page (paper corners or features → homography) before diffing; mask her hand (skin and motion, a growing region from the page edge); commit a change only after the hand has left and the ink has held for N samples. Evaluate on the demo clips and the owner's local clips (never committed).

A, C and D touch separate files and can run in parallel; B depends on A and C for its full pass but can be built now.

## Verification
Per workstream: `pnpm check`, `pnpm test:changed`, then B's live run. The owner tries a 5-turn script in `pnpm live` after A.
