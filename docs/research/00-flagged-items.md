# Flagged items: OpenAI Decisions API, "Astra", Jev, Qwen3.8 on Cerebras

Checked by the lead on 2026-10-17. These were the spec's two claims I couldn't confirm from memory; both turned out to be real, with some corrections.

## Bottom line

- **The OpenAI Decisions API exists.** It has been in public beta since 2026-10-06, at `POST /v1/decisions`. It runs on **`gpt-6-luna`**, the only supported model, not on "Astra". It accepts camera frames as inline base64 images and costs $0.10 per 1M input tokens, with no output charges.
- **"Astra" is a different model.** Third-party listings show GPT-6 Astra as a separate chat model, so the spec's "astra under the hood" is a mix-up. It doesn't change the plan: we call `/v1/decisions` with `gpt-6-luna`.
- **Multilingual support for the Decisions API is undocumented.** The spec's claim that it handles English, Spanish and Korean is unverified, so we must test it. Mitigation: write the questions in English. Only the input (handwriting and transcript) carries the student's language.
- **Use predicates rather than choices for "should the tutor interrupt now?"** Community tests found predicates well calibrated, while choices were overconfident and sensitive to the order of the options.
- **Jev is TypeSafe AI's decision model,** the competitor OpenAI's API responds to. It is cheaper ($0.042 per 1M input tokens) and faster in one small community test. It is English-first per the spec, and it's reachable through OpenRouter's own Decisions API (alpha), which also exposes GPT-6 Luna Decisions.
- **Qwen3.8 27B exists on OpenRouter with Cerebras as a provider** (`qwen/qwen3.8-27b`). It supports tools, structured output and streaming. One report puts Cerebras throughput at about 1,500 tok/s, against the spec's ~550; that figure is unverified against a primary source.

## OpenAI Decisions API

- **Endpoint and SDK:** `POST /v1/decisions`; `client.decisions.create` (JavaScript SDK ≥ 7.30.0, Python ≥ 3.26.0). Public beta since 2026-10-06 (previewed at DevDay on 2026-09-29), with GA "expected in the coming weeks". ([guide](https://developers.openai.com/api/docs/guides/decisions), [reference](https://developers.openai.com/api/reference/resources/decisions/methods/create), [announcement](https://community.openai.com/t/decisions-api-is-now-available-in-public-beta/1403877))
- **Model:** `gpt-6-luna` only. ([guide](https://developers.openai.com/api/docs/guides/decisions))
- **Input:** a text string, or user messages whose parts are `input_text` and `input_image`. Images must be inline base64 data URLs; hosted URLs and `file_id` are not supported.
- **Question types:** 1–200 per request, all evaluated over the same input.
  - `predicate` returns a `probability` from 0 to 1.
  - `choice` returns one of the supplied `choices` values, with `probabilities` and a `confidence`.
  - `score` takes ordered `levels` and returns a probability-weighted `score`, which can fall between levels.
  - Any single answer can come back as `refusal`.
  - Logic that depends on an earlier answer needs a separate request.
- **Price:** $0.10 per 1M input tokens, with no output, cache-read or cache-write charges and no input caching yet. Regional and long-context multipliers apply.
- **Latency:** the docs say "about 10x faster than the Responses API" but give no absolute figure. Community measurements: about 0.8 s per image request on a ~3 Mbps link. In one conversational test, Luna's median turn was 1.6 s against Jev's 0.3 s. ([thread](https://community.openai.com/t/decisions-api-is-now-available-in-public-beta/1403877))
- **Calibration:** in a community biased-coin test (70% heads), predicates returned 70%, but choices returned about 98% and shifted when the options were reordered. Anecdotal, but it points to using predicates. ([toy experiments](https://community.openai.com/t/results-from-toy-experiments-with-decisions-api/1404010))
- **Languages:** not mentioned in the docs.
- **Also relevant:** the docs link a "Connect voice to Decisions" guide, for choosing actions from spoken requests or reacting during speech. Read it during design of the voice loop.

## "Astra"

- No official source ties Astra to the Decisions API. Atlas Cloud lists `openai/gpt-6-astra` as a separate chat model, and its pages are inconsistent about image input. ([Atlas Cloud](https://www.atlascloud.ai/models/openai/gpt-6-astra)) The OpenAI model family seen in announcements is GPT-6 Sol and GPT-6 Luna. ([announcement](https://community.openai.com/t/announcing-gpt-6-sol-and-gpt-6-luna-in-the-api-codex-and-chatgpt/1399925))

## Jev (TypeSafe AI) and OpenRouter's Decisions API

- Jev is TypeSafe AI's decision model, listed at $0.042 per 1M input tokens. ([Dealroom](https://app.dealroom.co/news/note/openai-opens-decisions-api-to-all-developers-adding-image-input-in-challenge-to-typesafe-s-jev), [The New Stack](https://thenewstack.io/openai-decision-api-luna/))
- OpenRouter runs its own Decisions API in alpha at `POST https://openrouter.ai/api/alpha/decisions`. It serves GPT-6 Luna Decisions (up to 128 images per request), Jev (`~typesafe/jev-latest`, which also has **Box** questions that return bounding boxes), Cloudflare Clef/Clef Flash/Clef Omni, Mercury Decide and Liquid d1. Its schema differs from OpenAI's: a `state` array, a `questions` object, and a `noul` type instead of `predicate`. ([OpenRouter guide](https://openrouter.ai/docs/guides/community/multimodal-decisions.md))
- **Conflict on Jev image input:** a beta-thread commenter said Jev doesn't take images yet, but OpenRouter documents Jev image limits (PNG/JPEG, 256–1,568 px per side). Treat it as unresolved until tested.
- Community comparison: one small test found Jev more accurate on nuanced judgment calls, with Luna giving about 3x as many confident wrong answers; they were about even on simple yes/no checks. Anecdotal.

## Qwen3.8 27B on Cerebras via OpenRouter

- Model id `qwen/qwen3.8-27b`. OpenRouter lists Cerebras as a provider, and Cerebras serves only this model and `openai/gpt-oss-120b` there. Supported: `tools`, `tool_choice`, `response_format`, streaming. ([model](https://openrouter.ai/qwen/qwen3.8-27b), [Cerebras provider](https://openrouter.ai/provider/cerebras))
- Described as an open-weight dense vision-language model, released August 2026. Whether Cerebras accepts image input for it is **unverified**.
- Throughput: about 1,500 tok/s on Cerebras per a secondary report, which is **unverified**; the spec said ~550.
- Context on Cerebras is **conflicting**: one report says 64k on the free tier and 128k paid; an aggregator says 65,536 input and 32,768 output.
- Price on Cerebras: about $0.99 input and $1.49 output per 1M tokens. Other pages show different figures, so check the live page.
