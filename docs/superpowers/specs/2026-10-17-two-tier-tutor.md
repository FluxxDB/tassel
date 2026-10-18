# Two-tier tutor: a fast talker and a smart thinker

Date: 2026-10-17. Status: approved by the owner in chat (22:55). Supersedes the single-LLM voice loop for live sessions.

## Why

In the owner's third live test, gpt-6-astra (low) tutored much better than Qwen 3.8: it read the page and found the real mistake. But it took about 1.5 s to the first word, so the student kept interrupting it. Ada also kept re-confirming what the student meant instead of knowing it. Qwen 3.8 on Cerebras answers in about 0.4 s but reasons weakly.

The owner's direction: "For complicated questions, drawings, actions, or explanations, use a smarter model under the hood like astra. For all other chats (openers, fillers, explaining how SIMPLE things work), this should be handled by the MUCH cheaper and more responsive model qwen3.8 (should be almost instant feeling)… have astra return a loose guidance body of text for drawings and explanations, so the longer-thinking model runs fewer times and the cheaper model can explain from it."

## Design

**Talker: Qwen 3.8-27b on OpenRouter, Cerebras only.** It speaks every turn. It sees the conversation, the latest page image, and the session's tutor notes (below). On a turn that needs real thought, it first says a short, natural bridge that fits the moment ("Let me look at your arrows…"), never a canned filler, then waits for the brief. It never invents board tags itself for complex drawings; it uses the brief's tags.

**Thinker: gpt-6-astra, `reasoning_effort=low`, through OpenAI.** It doesn't speak. It's called in the background and returns a **guidance brief**, a JSON object validated against a schema:
- `page`: what's on the paper (transcription, diagram as states and edges, anything unclear);
- `intent`: what the student is trying to do or asking;
- `diagnosis`: the mistake or misconception, if any, with evidence;
- `plan`: 1–4 teaching steps on the Socratic escalation ladder (question → counterexample → explanation → solution only if asked);
- `say`: the opening line for the talker to adapt, natural speech;
- `board`: validated board tags to draw, if a drawing helps or was asked for;
- `paper`: validated paper-mark tags on the page's numbered marks (m1…), if the student asked to mark their paper or camera feed, or a mark points at the mistake;
- `confidence`, and `followups`: answers the talker can give without calling again.

Tags are validated with the same parser the beats use. Invalid ones are dropped and logged.

**When the thinker runs** (any one of these):
- the talker emits `[[consult]]` at the start of its reply;
- the student asks to draw, mark, highlight, check, find a mistake, or explain why;
- the page changed meaningfully since the last brief (new ink beyond a threshold);
- at most one in-flight thinker call per session. A newer trigger supersedes the stale one.

**Tutor notes (the cheap retrieval).** Every brief is kept in the session as a tutor note: the latest note in full, plus older notes summarized. Each talker call carries them in its system context, so follow-up turns ("why that state?", "what next?") are answered by the talker from the notes without a new thinker call. Notes expire when the page changes enough to invalidate them.

**Where the drawing goes.** "On my paper", "on my camera" and "circle mine" mean paper marks: freeze, then circle, number, check, strike or callout on m#. Only an explicit board request, or a brief that needs a new diagram, uses the whiteboard. Board drawings stay small: the student's automaton or the minimal fix, not a whole new machine, unless asked.

**Latency budget.** The talker's first audio in under 800 ms. The bridge line is spoken while the thinker works, typically 1.5–2.5 s. The thinker's result is spoken as the talker's next sentence, in the same turn when possible.

## Also in this change
- **Transcripts on disk (dev runs):** `.cache/live/transcripts/<session>.jsonl` gets the student's finals, Ada's lines, thinker briefs, tags, rejects and timings. It's git-ignored, and holds no keys and no images.
- **Turn-taking (P2 Task 5 essentials):** a backchannel filter, so "mm-hmm" and "yeah" don't interrupt Ada, and a slightly longer end-of-turn wait. Interrupting Ada needs real words.
- **Speech:** ElevenLabs text normalization on. Ada writes natural numbers and symbols ("zero one zero one" stays spelled out, "q0" stays as is), and the TTS normalizes them. Use the voice settings and model that sound most natural within a 300 ms first-audio budget (Flash v2.5 vs Turbo v2.5, measured).
- **Student whiteboard controls:** pan by dragging, zoom with pinch or the scroll wheel, and a Fit button. Ada's camera moves still work. Student moves don't fight Ada's until her next action.
