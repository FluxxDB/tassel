# ElevenLabs avatar voice catalog — prepared, not activated

The owner asked to keep ElevenLabs speech OFF until they authorize a live test.
This pass performs metadata GETs only. No synthesis, preview audio download,
voice cloning, subscription change or voice-library account addition occurred.

## Existing integration

The existing protected `services/server/src/tassel/voice/providers.py` already
constructs `ElevenLabsTTSService` with `eleven_flash_v2_5`. VoiceSettings already
supports `ELEVENLABS_API_KEY` and per-language `TASSEL_VOICE_EN/ES/KO`, defaulting
to Matilda. None of that code was changed. The avatar's selections are currently
local preferences, not inputs to this live adapter.

## Default cost behavior

- All three avatar voice selections default to `off`. Previous placeholder
  selections migrate to off while preserving the person's appearance and name.
- Selecting a catalog voice saves its ID locally for later. It does not enable
  synthesis, start a live session, play a preview, or change provider settings.
- `pnpm dev` now sets TTS to fake unless the launching process explicitly sets
  `TASSEL_TTS_PROVIDER`. A stored key or global `TASSEL_PROVIDERS=live` alone
  cannot activate paid TTS through this launcher. Do not set a live/auto TTS
  override for the owner until they authorize real testing.
- The existing local avatar shortcut remains fake. Direct standalone server or
  dedicated live launch commands retain their pre-existing provider behavior;
  they are not made safe by a UI selection of `off`. The integration owner
  must preserve this distinction when wiring runtime voice preferences.

## Canonical catalog

`apps/desktop/src/renderer/src/avatar/voices.json` contains 18 real public voice
records retrieved from ElevenLabs, including names, voice IDs, provider-reported
languages/accents, preview URLs, a fetch timestamp, availability and verification
flags. `synthesisEnabled` is false. The menu offers 16 after excluding candidates
whose names describe angry or romance performances; none have been listen-tested.

Coverage: American, British, Indian and Australian English; Mexican Spanish;
Korean (Seoul/standard labels). The Castilian query returned no candidates;
that gap is explicitly recorded, not filled with an invented voice ID.
Language/accent labels are provider metadata, not claims about anyone's race.
Appearance and voice remain independent.

All returned candidates were `library-only` in this account check. That means
they are public discovery candidates, not verified ready-to-use account voices.
No automatic account additions were made. Provider availability can change;
refresh and confirm account access before using any of them live.

## Refresh (owner-authorized metadata access only)

From the repo with Node/pnpm/uv available:

```text
node scripts/sync-avatar-voices.mjs --refresh
```

The Node/cross-spawn wrapper invokes
`tassel.scripts.export_avatar_voices --metadata-only` in the server environment.
The existing server settings loader handles the key; it never crosses into the
Node wrapper or renderer. The exporter performs only:

- `GET https://api.elevenlabs.io/v1/shared-voices` with female/language/accent filters;
- `GET https://api.elevenlabs.io/v2/voices` restricted to the discovered public IDs,
  to check account availability.

Only whitelisted public metadata is written. No samples, owner emails, private
voice records or credentials are exported. HTTP failures report status only,
and failed/empty exports preserve the previous catalog. Refresh is never invoked
at app startup, during customization, or by tests.

References:
- https://elevenlabs.io/docs/api-reference/voices/voice-library/get-shared
- https://elevenlabs.io/docs/api-reference/voices/search

## Future integration handoff — coordinate with the voice owner

1. Obtain the owner's authorization to test real voices; do not treat choosing
   a catalog item as authorization to spend credits.
2. Confirm account access, sharing terms, model/language compatibility and sample
   quality for a small shortlist. Do not add library voices automatically.
3. Add a server-validated mapping from avatar `voiceEn`, `voiceEs`, `voiceKo` to
   actual provider voice IDs, with an explicit runtime synthesis-enable gate.
   `off` must keep fake TTS. Do not pass client-provided arbitrary voice IDs through.
4. Keep existing environment voice overrides and language routing intentional,
   and document which source wins. Revalidate retired/unavailable IDs gracefully.
5. Treat stored preview URLs only as metadata until preview use is authorized.
   Do not fetch them automatically. Never ship or log the provider API key.

## Validation

Two mocked exporter tests verify GET-only endpoints, removal of private fields
and credential-safe errors. Two Node tests verify default-off TTS even with a
key/global-live mode, while preserving an explicit owner override. Avatar tests
verify off defaults and migration. Electron verifies that voice choices are only
on Body, persist after reload, and make no ElevenLabs or media requests.
