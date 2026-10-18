"""Per-session usage meter: model tokens, speech characters and listening seconds. Prices are
optional (settings); without them the meter reports usage only. Keys avoid the word "token",
which the dev transcript filters out as secret-looking."""

from collections import defaultdict


class CostMeter:
    def __init__(self, prices: dict[str, dict[str, float]] | None = None):
        # Prices are USD per million: {"model": {"prompt": x, "cached": y, "completion": z}}.
        self.prices = prices or {}
        self._llm: dict[str, dict[str, int]] = defaultdict(
            lambda: {"calls": 0, "prompt": 0, "cached": 0, "completion": 0}
        )
        self.tts_chars = 0
        self.stt_seconds = 0.0

    def llm(self, model: str, *, prompt: int, cached: int = 0, completion: int = 0) -> None:
        entry = self._llm[model]
        entry["calls"] += 1
        entry["prompt"] += int(prompt or 0)
        entry["cached"] += int(cached or 0)
        entry["completion"] += int(completion or 0)

    def tts(self, chars: int) -> None:
        self.tts_chars += int(chars or 0)

    def stt(self, seconds: float) -> None:
        self.stt_seconds += float(seconds or 0)

    def summary(self) -> dict:
        out = {
            "llm": {model: dict(entry) for model, entry in self._llm.items()},
            "tts_chars": self.tts_chars,
            "stt_seconds": round(self.stt_seconds, 3),
        }

        # Keys may carry a role ("thinker:gpt-6-luna"); prices are by model.
        def price(key):
            return self.prices.get(key) or self.prices.get(key.split(":", 1)[-1])

        priced = [m for m in self._llm if price(m)]
        if priced:
            usd = 0.0
            for model in priced:
                e, p = self._llm[model], price(model)
                fresh = max(e["prompt"] - e["cached"], 0)
                usd += (
                    fresh * p.get("prompt", 0)
                    + e["cached"] * p.get("cached", p.get("prompt", 0))
                    + e["completion"] * p.get("completion", 0)
                ) / 1_000_000
            out["usd"] = round(usd, 6)
        return out
