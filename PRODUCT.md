# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated (confirmed 2026-10-17): Electron + React + TypeScript for the desktop app, plus a small server on Vultr for the voice loop and AI calls. Claude picks the frameworks and libraries after research and records them in the design doc for review.

## Users

Students doing STEM homework or studying at a desk, with paper and a pencil in front of them and a Mac open. The mission focus is women returning to STEM, including immigrants and asylum seekers re-certifying engineering or medical degrees across a language barrier. They work in English, Spanish or Korean.

## Product Purpose

Tassel is a live AI tutor for the desktop. It talks with the student in real time, and either one can interrupt. It watches her paper through macOS Desk View, or her screen when she shares it, decides when to step in, and explains by drawing on a shared whiteboard and directly over her own work. A learning engine remembers what she knows and what the tutor should recall, so sessions build on each other.

Success: she understands *why* her work is wrong, in her own language, from a tutor she relates to.

## Positioning

Not a chatbot you type into. Tassel is a tutor that sees your work and draws on it: it watches the paper or screen in front of you, talks it through out loud, and marks up your own work. It works in English, Spanish and Korean, through a woman tutor you customize.

## Operating Context

- **The session** is the unit of work, like a chat in a chatbot. It starts as "Untitled Session" and gets an AI-generated title from the first message. It also carries an AI-extracted subject, a type (homework, studying, research and so on), and created and last-modified dates. Sessions live in a library, sorted by last activity, date created, or topic.
- **Paper view:** a Mac's Desk View camera (the built-in Center Stage camera or an iPhone through Continuity Camera) shows the worksheet on the desk. The tutor sees it and can draw over the live feed, beside the whiteboard.
- **Screen share:** the app collapses to a translucent overlay bar, like Claude desktop or Cluely, while the student works in other apps such as a PDF reader. The spec leaves the details open.
- **Windows:** the dev team uses Macs and Windows PCs. Windows has no Desk View, so the app warns and steers the student to screen share. macOS is the primary target.
- **The demo:** presented live by Josephine. It is mostly in English with a Korean segment the audience must still be able to follow. The flow:
  1. Open the app and start a session.
  2. Turn on the camera and Desk View, then draw an incorrect DFA for "binary strings that start with 010" while narrating. The tutor gives a hint or two.
  3. The tutor interrupts with a counterexample.
  4. In a split view, the tutor draws over her paper to show where and why the DFA fails.
  5. The tutor draws the correct DFA on the whiteboard.
  6. Screen-share Q&A on a PDF, for example "draw me a diagram of this cell bio concept".
  7. A Korean exchange.
  8. Tutor customization.

## Capabilities and Constraints

- Real-time voice: speech-to-text → tutor LLM → text-to-speech, with barge-in in both directions.
- Vision-triggered interruptions: changes to the handwriting in the camera feed trigger a fast decision model that judges whether to step in.
- Whiteboard: the tutor draws on it as it explains, and the student draws on it too, with changes visible to the AI.
- Tutor: a customizable 2D SVG woman, with skin, eyes, hair style and hair color options and simple mouth-shape lip-sync. She appears like a webcam feed in the app and in the collapsible dock. The voice is always female, with a choice of accent.
- Every AI component works in English, Spanish and Korean.
- A learning engine tracks what the student knows, her level, and the tutor's memories.
- Vultr is part of the stack (hackathon track requirement).
- **Undecided:** screen-share details, beyond the overlay bar.

## Brand Commitments

- **Name:** Tassel.
- **Visual authority:** the Refero extraction of hume.ai in `docs/design-system/DESIGN.md` ("Use Refero style for the entire app"). Where its fonts are license-blocked, use Geist Sans and a fitting Korean font. Diagrams and animations the tutor produces follow the same style.
- **Avatar style:** `docs/source/ghh-avatar-reference.png` (soft flat illustration, gentle gradients).
- **The tutor is always a woman.** This is part of the mission, not a default.

## Evidence on Hand

- The spec (`docs/source/ghh.md`), the design-system files (`docs/design-system/`), and the avatar reference image.
- The pitch cites a Stanford study (women are more likely to express interest in STEM when their tutors are women) and a claim that more women than men fail to re-certify engineering or medical degrees because of language barriers. Neither has a source yet: show no statistics or study details until they are cited.
- No users, testimonials or metrics exist; do not invent any.

## Product Principles

1. **See the work, not just the words.** The tutor reasons from the student's actual paper or screen.
2. **Interrupt like a good tutor.** Rarely, at natural pauses, escalating from hint to counterexample to explanation to answer, and giving the answer only when asked.
3. **Show it on her own work.** Mark up the student's own work and the shared board rather than describing from a distance.
4. **Her language, her tutor.** English, Spanish and Korean are equally first-class, and the woman tutor is one the student customizes.
5. **Compute correctness when possible.** For example, check a DFA by algorithm rather than letting a model guess.

## Accessibility & Inclusion

- Interface and AI at full parity in English, Spanish and Korean, with Korean typography supported properly.
- Live captions and a transcript for everything spoken. These also let the demo audience follow the Korean segment.
