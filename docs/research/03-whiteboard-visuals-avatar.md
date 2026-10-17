# Whiteboard, visuals & avatar research

*2026-10-17.* Updated demo, now mostly in English:
1. The student draws an incorrect DFA on paper.
2. The tutor interrupts with a counterexample.
3. The tutor traces that counterexample over her paper.
4. The tutor draws the correct DFA on the whiteboard.

Questions 3 and 1 weigh most. [n] = Sources; 01, 02 and 04 are sibling reports.

## Bottom line

- **Use tldraw 5.5 for the whiteboard.** It covers everything the demo needs (Finding 1). **Risk:** tldraw is not open source. Production use needs a license key: a free 100-day trial, a non-commercial hobby license (granted case by case, watermarked), or a paid commercial license [1–4]. Get a trial key now. Keep a thin wrapper so Excalidraw (MIT) stays a fallback.
- **Compute correctness; the LLM only narrates.** A small TypeScript checker over both DFAs gives the shortest counterexample, its trace, the first wrong step and one-edit fixes. automata-lib (Python, MIT) can serve as a test oracle [48]. **This changes 01's plan:** Opus should only transcribe her DFA, not return the verdict.
- **The riskiest step is reading her handwritten DFA.** Positions from the vision model are approximate [56]. Snap states to circles detected with OpenCV.js, and draw the trace over a frozen frame, as 02 also suggests.
- **Draw the correct DFA from a Graphviz layout** [50], converted to tldraw shapes and prepared in advance. `@tldraw/mermaid` is a no-code fallback, but its output looks like UML [5][16].
- **Keep Manim out of the live loop.** Rendering alone takes seconds to minutes [31], before code generation and retries, and it produces a video nobody can edit. Animate the whiteboard instead. ManimGX (Manim in the browser) is 12 days old and can't render Korean [35].
- **Drive drawing and lip-sync from one clock:** ElevenLabs character timestamps [60–62], generated one "beat" (a sentence plus its board actions) at a time.
- **Avatar:** a layered inline SVG with CSS variables and Rhubarb's 9 mouth shapes [58], chosen from the text and its timestamps. The Rhubarb tool itself needs whole audio files, so it's for checking only. No library matches the reference style.

## Findings

### 1. tldraw vs Excalidraw

| | tldraw 5.5.2 (Oct 2026) | Excalidraw 0.18.1 (Apr 2026) |
|---|---|---|
| License | Source-available; production needs a key [1][2]. Trial: 100 days, no watermark, one per business unit. Hobby: non-commercial, case by case, watermark. Commercial: priced by sales [2–4]. No hackathon terms found. Without a key in production, the editor stops after 5 s [3]. | MIT [18] |
| Electron, React | Non-HTTPS pages, localhost or a non-production `NODE_ENV` count as development [3], but the license calls serving end users production [1]. Electron isn't covered (**UNVERIFIED**; ask sales). Assets can be self-hosted [13]. React 18.2+ or 19.2+ [6]. | Fonts can be self-hosted [24]; React 17–19 [19] |
| Rendering | HTML/SVG via React; CSS animation works on the live board [17] | `<canvas>`; Excalidraw's own MCP app animates as SVG outside the editor [27] |
| AI drawing | `animateShape` (x, y, rotation, opacity) [10]; freehand points stored as base64 [11]; an arrow attached to the same shape twice draws a self-loop [16]; custom geo shapes, `@tldraw/driver`, `@tldraw/mermaid` [5][15]; agent kit streams `pen` strokes [7] | `updateScene` [20]; element "skeleton" API in beta [21]; Mermaid import handles flowcharts only [23] |
| Student edits | `store.listen(…, {source:'user'})`; tutor edits made inside `mergeRemoteChanges` are tagged `remote` [8]; `toImage(ids)` exports just those shapes [9] | `onChange`; diff by element `version` [28]; export any subset [22]; can't tell user edits from code |
| Fonts, colors | Custom colors and font families via themes [12] | 3 fonts, no font API found [25]; Korean fallback only behind Excalifont [26] |

**Verdict: tldraw.** Excalidraw's fonts clash with the design system, it has no native state diagrams, and live animation means working outside its canvas.

To reveal drawings progressively:
- fade shapes in with `animateShape`;
- grow a freehand stroke frame by frame, as the kit's `PenActionUtil` does [7];
- animate `stroke-dashoffset` in a custom shape.

Strokes from `@tldraw/driver` probably register as student edits (my inference), so tag them. Put temporary highlights, such as pulses or a token moving along an arrow, in an `OverlayUtil`, which isn't saved [14]. The LLM should send commands like "add state q2", never coordinates.

### 2. Manim and in-app alternatives

**Render time.** Manim Community 0.22.0 and ManimGL 1.7.2 are current [29][30]; `-qm` is 720p at 30 fps [32]. I found no 720p benchmark (**UNVERIFIED**). The closest was run by the rival ManimGX project on an M4 Pro at 1080p60 [31]:
- Manim Community: 4.7–39 s for four scenes 3–13 s long, and 212 s for a 10 s 3D camera orbit.
- ManimGL: 1.8–16.8 s for the same scenes.

Code generation, LaTeX and retries come on top, and layouts often go wrong. TheoremExplainAgent reports layout issues in most of its videos [36]. In the PRISM benchmark, about 41% of programs that run still fail its spatial checks [37].

**Server and style.** There's an official Docker image [34] (speed on Vultr **UNVERIFIED**). `Text` handles Korean and custom fonts [33], but math needs a custom LaTeX template.

**Verdict.** Fine for a recap clip delivered later (rendered on Vultr), not mid-conversation. ManimGX runs Manim's API in the browser (about 26 MB, WebGPU) but has no Chinese, Japanese or Korean text yet [35].

**Instant alternatives:**
- the whiteboard's own shapes (the default);
- SVG animated with CSS or GSAP, now free with its plugins [38];
- perfect-freehand or rough.js for a hand-drawn marker look [43];
- d3-graphviz for animated graph transitions [39];
- Mafs or JSXGraph plots inside a custom shape [40].

Motion Canvas and Remotion are video tools, more than we need [41][42].

### 3. DFA demo: read, verify, explain, redraw

**Read her paper.** The frame comes from 02's window capture of Desk View.
- Ask the vision model for strict JSON: states (label, start, accept, approximate center) and transitions (from, to, symbols).
- Claude's positions are approximate [56]; Gemini returns `box_2d` boxes on a 0–1000 scale [57].
- Snap states to circles found by OpenCV.js `HoughCircles` (`@techstark/opencv-js`, Apache-2.0) [44]. Two circles sharing a center confirm an accept state.
- For ambiguous labels, use Set-of-Mark prompting: number the candidate regions and have the model answer by number [45].
- Freeze the frame, and have the tutor read the DFA back aloud so any misreading surfaces.

**Check it.** A breadth-first search over (student state, reference state) pairs, shortest strings first, runs in milliseconds. It yields:
1. the shortest counterexample, and whether her DFA wrongly accepts or wrongly rejects it;
2. its trace through both DFAs;
3. the blame step: the first transition after which the two states stop accepting the same strings;
4. one-edit fixes: flip each accept flag, or redirect each transition, and re-check. That is fewer than 40 checks for 4 states and 2 symbols, similar to edit-distance grading [46].

Report missing transitions separately; by convention they reject.

Libraries:
- automata-lib 9.2 (Python, MIT) offers `allow_partial`, `symmetric_difference`, `minimum_word_length`/`words_of_length` and `read_input_stepwise`, which makes it a good test oracle [48].
- refa (MIT, last release 2023) is awkward for this [49].

Hand-write the demo's reference DFA. In general, trust an LLM-written reference only if it agrees with an independent, LLM-written test function on every string up to length 12. In a 377-student study, both counterexamples and hints helped [47].

**Draw over her paper.** Put an SVG layer over the frozen frame, or a second tldraw board with the frame as a locked image. For each symbol:
1. advance a cursor along the input string;
2. glide a token along the arrow;
3. ring the current state.

Finally, mark the accept/reject mismatch and circle the blamed transition in Iris (#c094e4) with a hand-drawn stroke.

**Redraw on the whiteboard.**
- **Graphviz** natively supports left-to-right layout, double circles and self-loops [50]. `@viz-js/viz` `renderJSON` (MIT) returns positions and edge curves [51][52]; `@hpcc-js/wasm-graphviz` (Apache-2.0) is an alternative [53].
- **dagre** (MIT) also handles self-loops [54]. **ELK** (EPL-2.0 or GPL-3.0) is heavier [55].
- **`@tldraw/mermaid`** turns `stateDiagram-v2` into native shapes, self-loops included [16]. But states come out as rounded rectangles unless remapped with `mapNodeToRenderSpec` [5].

Draw states as ellipses, accept states as a custom double ellipse [15], and transitions as attached, labelled arrows. Give the start arrow an attachment only at its end. Reveal everything in narration order. The result can be read back from its arrow attachments, so the student's edits are re-checked without vision.

### 4. Avatar and lip-sync

**SVG.** Layers, back to front: back hair, clothes, neck, head, ears, blush, eyes (white, iris, highlight, lid), brows, mouth slot, front hair, scrunchie.
- Colors are CSS variables on the inline `<svg>`. Gradient stops use `style="stop-color: var(--hair)"` (the CSS property, not the attribute) [73]. Shades use `color-mix(in oklab, var(--hair) 70%, black)` [74].
- Hair styles are swappable front/back pairs, and the shared mouth pack takes its lip color from the skin.

**Mouth shapes.** Rhubarb uses A–F plus optional G (F/V), H (L) and X (rest). These map to Preston Blair's names as A=MBP, B=etc, C=E, D=AI, E=O, F=U, G=FV, H=L, X=rest [58]. The 15 Oculus visemes are too fine-grained for a dot-eyed face [59].

**Timestamps.**
- ElevenLabs returns per-character times via `/with-timestamps` and `/stream/with-timestamps` [60][61].
- WebSocket times restart with each chunk, so keep a running offset [62].
- Support per model isn't documented (**UNVERIFIED** for v3/v4) [63][64].
- Pipecat (01's choice) emits word timings [65]. These work if mouth shapes are spread across each word.

**Text to mouth shapes.**
- **English:** `phonemize` (MIT) gives ARPAbet phonemes [66]. Map P/B/M→A, F/V→G, L→H, AA/AY→D, EH/AE/AH→C, AO/ER→E, UW/UH/OW/W→F, and everything else→B.
- **Spanish:** spelling is nearly phonetic, and b sounds like v [67]. Map a→D, e→C, i→B, o→E, u→F, b/v/m/p→A, f→G, l→H.
- **Korean:** split each syllable into its letters with idx = code point − 0xAC00: initial = ⌊idx/588⌋, vowel = ⌊(idx mod 588)/28⌋, final = idx mod 28 [68]. The es-hangul library also does this [69]. Map ㅏ→D, ㅓ/ㅐ/ㅔ→C, ㅗ→E, ㅜ→F, ㅡ/ㅣ→B, ㅁ/ㅂ/ㅃ/ㅍ→A.
- **All languages:** merge cues shorter than about 50 ms, and insert C between A/B and D, as Rhubarb does [58].

**Rhubarb** (MIT, v1.14) reads only whole WAV or OGG files; ElevenLabs can output WAV [60]. Its main recognizer is English-only and its speed is unpublished (**UNVERIFIED**) [58], so use it offline for checking. Audio-only fallbacks: HeadAudio (MIT, trained on English) [59] and wawa-lipsync (MIT) [70].

**Idle animation and libraries.**
- Blink at random every 2–6 s, about 150 ms per blink; people average about 14 blinks a minute [71].
- Breathe with a 1–2 px torso rise over about 4 s, and respect `prefers-reduced-motion`.
- No library matches the reference style; DiceBear's artwork licenses vary [72].

**Recommendation:** use the 9 shapes (G and H can reuse B and C) in Rhubarb-compatible JSON:

```json
{ "version": 1, "utteranceId": "beat-07", "lang": "en", "shapeSet": "rhubarb9",
  "durationSec": 2.84,
  "mouthCues": [ {"start": 0.00, "end": 0.07, "value": "X"},
                 {"start": 0.07, "end": 0.19, "value": "B"},
                 {"start": 0.19, "end": 0.33, "value": "D"} ],
  "words":   [ {"text": "Try", "start": 0.07, "end": 0.33} ],
  "markers": [ {"id": "hl-q2", "at": 1.12} ] }
```

Times are seconds from the start of the beat's audio. Cues are sorted, leave no gaps, and start and end on X. Each animation frame, the player looks up the current cue, and `markers` time the board actions.

## Spec claims that don't check out

1. **"Manim takes seconds":** rendering takes seconds to minutes; end to end it takes tens of seconds, and the output is a video nobody can edit. For matching fonts, use Geist plus Pretendard (04) [75].
2. **tldraw and Excalidraw as interchangeable free options:** tldraw needs a production key, and Excalidraw can't load the app's fonts.
3. **"JSON of which mouth shape each word needs":** ElevenLabs returns timings, not mouth shapes. We derive the shapes within each word ourselves.
4. **Customizable eye color:** the reference's dot eyes can't show color.
5. **Korean demo:** the demo is now mostly English, so English pronunciation lookup is the critical path.

## Recommendation for a fast build

**Day 1**
- Set up tldraw in Electron with self-hosted assets and a theme (Ink #222222, Iris #c094e4, pastel fills, Geist plus Pretendard). Request the trial key.
- Write the TypeScript DFA checker and test it on the real homework. Hand-write the reference DFA with a prepared layout.
- Build the board operations: `addState`, `addAcceptState`, `addTransition`, `reveal`, `drawOn`, `pulse`, `traceToken`, `zoomTo`. Route tutor edits through `mergeRemoteChanges`, and send the student's changed shapes as an image plus JSON.

**Day 2**
- Build the pipeline: freeze a frame → get the DFA as JSON → snap states to detected circles → run the checker → have the LLM write beats from the checker's facts → trace over her paper → reveal the correct DFA.
- Speak each beat with timestamps that drive both the board actions and the mouth.
- Build avatar v1: one hair style, three skin tones, two eye shapes, nine mouths, blinking and breathing.

**Cut:** Manim (or one clip rendered on Vultr, if that track needs it), live tracking of the paper, and polish on Korean lip-sync.

## Open questions for the product owner

1. Will Tassel be sold commercially? That decides between a paid tldraw license and switching to Excalidraw.
2. What is the exact homework problem: the language, the alphabet, and her incorrect DFA? Does a missing transition mean reject?
3. Is a frozen paper snapshot OK during the trace, or must the overlay follow the live feed?
4. Should the student be able to edit the tutor's corrected DFA, with live re-checking?
5. Can the eyes be larger so eye color shows? How many hair styles and skin tones for v1?
6. Do the judges expect Manim specifically?
7. Which ElevenLabs model will we use? Timestamp support may differ.

## Sources

**Whiteboard: tldraw**
1. tldraw license text: https://github.com/tldraw/tldraw/blob/main/LICENSE.md
2. tldraw license overview (trial, hobby, watermark): https://tldraw.dev/community/license
3. tldraw license keys (development vs production, behavior without a key): https://tldraw.dev/sdk-features/license-key
4. tldraw pricing: https://tldraw.dev/pricing
5. tldraw v5.0.0 release notes (themes, overlays, custom geo shapes, driver, mermaid): https://tldraw.dev/releases/v5.0.0 · v5.5.0 release notes: https://tldraw.dev/releases/v5.5.0
6. tldraw on npm (5.5.2, React requirements): https://www.npmjs.com/package/tldraw
7. tldraw agent starter kit: https://tldraw.dev/starter-kits/agent · `PenActionUtil` source: https://github.com/tldraw/tldraw/blob/main/templates/agent/client/actions/PenActionUtil.ts
8. tldraw store: https://tldraw.dev/sdk-features/store · persistence (`mergeRemoteChanges`): https://tldraw.dev/sdk-features/persistence
9. tldraw image export: https://tldraw.dev/sdk-features/image-export
10. tldraw animation: https://tldraw.dev/sdk-features/animation
11. tldraw default shapes: https://tldraw.dev/sdk-features/default-shapes
12. tldraw themes: https://tldraw.dev/sdk-features/themes · custom theme example: https://tldraw.dev/examples/custom-theme
13. tldraw static assets: https://tldraw.dev/examples/static-assets · installation: https://tldraw.dev/installation
14. tldraw overlay utilities: https://tldraw.dev/sdk-features/overlay-utils
15. tldraw custom geo shapes: https://tldraw.dev/examples/shapes/tools/custom-geo-types
16. `@tldraw/mermaid` source (self-loop anchors and arrow attachments): https://github.com/tldraw/tldraw/blob/main/packages/mermaid/src/svgParsing.ts · https://github.com/tldraw/tldraw/blob/main/packages/mermaid/src/renderBlueprint.ts
17. "20 things I wish AI chatbots knew about tldraw" (12 Jun 2026): https://tldraw.dev/blog/20-things-i-wish-ai-chatbots-knew-about-tldraw

**Whiteboard: Excalidraw**

18. Excalidraw license (MIT): https://github.com/excalidraw/excalidraw/blob/master/LICENSE
19. `@excalidraw/excalidraw` on npm: https://www.npmjs.com/package/@excalidraw/excalidraw
20. Excalidraw API: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api
21. Excalidraw element skeleton API: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton
22. Excalidraw export utilities: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export
23. mermaid-to-excalidraw API (flowcharts only): https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api
24. Excalidraw installation (self-hosted fonts): https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation
25. Excalidraw constants (font families): https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/constants
26. Excalidraw CJK font (Xiaolai, covers Hangul): https://plus.excalidraw.com/blog/adding-hand-drawn-font-for-chinese-japanese-korean
27. Official Excalidraw MCP app architecture: https://github.com/excalidraw/excalidraw-mcp/blob/main/CLAUDE.md
28. Excalidraw element types (`version`, `customData`): https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/types.ts

**Manim and alternatives**

29. manim on PyPI: https://pypi.org/project/manim/
30. manimgl on PyPI: https://pypi.org/project/manimgl/
31. ManimGX benchmark (run by the ManimGX project): https://github.com/academa-labs/manimgx/tree/main/benchmarks
32. Manim output settings and quality flags: https://docs.manim.community/en/stable/tutorials/output_and_config.html
33. Manim `Text` and `register_font`: https://docs.manim.community/en/stable/reference/manim.mobject.text.text_mobject.html
34. Manim Docker image: https://docs.manim.community/en/stable/installation/docker.html
35. ManimGX: https://github.com/academa-labs/manimgx · browser rendering: https://manimgx.academa.ai/user-guide/rendering/
36. TheoremExplainAgent paper: https://arxiv.org/abs/2502.19400
37. PRISM benchmark paper: https://arxiv.org/abs/2605.19382
38. GSAP standard license: https://gsap.com/standard-license
39. d3-graphviz: https://github.com/magjac/d3-graphviz
40. Mafs: https://github.com/stevenpetryk/mafs · JSXGraph: https://github.com/jsxgraph/jsxgraph
41. Motion Canvas: https://www.npmjs.com/package/@motion-canvas/core
42. Remotion license: https://github.com/remotion-dev/remotion/blob/main/LICENSE.md
43. perfect-freehand: https://github.com/steveruizok/perfect-freehand · rough.js: https://github.com/rough-stuff/rough

**DFA demo**

44. OpenCV.js circle detection tutorial (site blocked my automated fetch; content unchecked): https://docs.opencv.org/4.x/d3/de5/tutorial_js_houghcircles.html · package: https://www.npmjs.com/package/@techstark/opencv-js
45. Set-of-Mark prompting: https://arxiv.org/abs/2310.11441
46. Alur et al., "Automated Grading of DFA Constructions" (IJCAI 2013): https://www.ijcai.org/Proceedings/13/Papers/292.pdf
47. D'Antoni et al., "How Can Automatic Feedback Help Students Construct Automata?" (TOCHI 2015): https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/tochi15.pdf
48. automata-lib DFA API: https://caleb531.github.io/automata/api/fa/class-dfa/
49. refa: https://github.com/RunDevelopment/refa
50. Graphviz finite-state-machine example: https://graphviz.org/Gallery/directed/fsm.html
51. Graphviz JSON output: https://graphviz.org/docs/outputs/json/
52. Viz.js API (`renderJSON`): https://viz-js.com/api/
53. `@hpcc-js/wasm-graphviz`: https://www.npmjs.com/package/@hpcc-js/wasm-graphviz
54. dagre self-loop handling (source): https://github.com/dagrejs/dagre/blob/master/lib/layout.ts
55. ELK self-loop option: https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-edgeRouting-selfLoopDistribution.html
56. Claude vision limitations: https://platform.claude.com/docs/en/build-with-claude/vision · coordinates guide: https://platform.claude.com/docs/en/build-with-claude/vision-coordinates
57. Gemini image understanding (`box_2d`): https://ai.google.dev/gemini-api/docs/image-understanding

**Avatar and lip-sync**

58. Rhubarb Lip Sync: https://github.com/DanielSWolf/rhubarb-lip-sync
59. TalkingHead: https://github.com/met4citizen/TalkingHead · HeadAudio: https://github.com/met4citizen/HeadAudio
60. ElevenLabs text-to-speech with timestamps: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
61. ElevenLabs streaming with timestamps: https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-timestamps
62. ElevenLabs WebSocket (timings restart with each chunk): https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
63. ElevenLabs models: https://elevenlabs.io/docs/overview/models
64. ElevenLabs Text to Dialogue WebSocket: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd
65. Pipecat ElevenLabs text-to-speech service: https://github.com/pipecat-ai/pipecat/blob/main/src/pipecat/services/elevenlabs/tts.py
66. phonemize: https://www.npmjs.com/package/phonemize
67. Spanish orthography: https://en.wikipedia.org/wiki/Spanish_orthography
68. Unicode Core Specification, chapter 3 (Hangul syllables): https://www.unicode.org/versions/latest/core-spec/chapter-3/
69. es-hangul: https://github.com/toss/es-hangul
70. wawa-lipsync: https://github.com/wass08/wawa-lipsync
71. Blink rate (Wascher et al., 2015): https://pmc.ncbi.nlm.nih.gov/articles/PMC4849103/
72. DiceBear licenses: https://www.dicebear.com/licenses/
73. MDN, `stop-color`: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stop-color
74. MDN, `color-mix()`: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix
75. Geist font: https://github.com/vercel/geist-font · Pretendard: https://github.com/orioncactus/pretendard
