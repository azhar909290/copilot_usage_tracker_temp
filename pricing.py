"""Flat USD usage pricing for combined input and output tokens."""


class PriceBook:
    currency = "USD"
    per_million = 0.99

    def cost(self, names: list[str | None], input_tokens: int, output_tokens: int):
        cost = (input_tokens + output_tokens) * self.per_million / 1_000_000
        return "flat-rate", cost
