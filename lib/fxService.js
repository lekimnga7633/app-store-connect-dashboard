const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

class FxService {
  constructor(cacheStore, options = {}) {
    this.cacheStore = cacheStore;
    this.displayCurrency = String(options.displayCurrency || "USD").trim().toUpperCase();
    this.fxApiBaseUrl = options.fxApiBaseUrl || "https://open.er-api.com/v6/latest";
  }

  async convertSummaryToDisplayCurrency(summary) {
    const byCurrency = Array.isArray(summary?.byCurrency) ? summary.byCurrency : [];
    if (!byCurrency.length) {
      return {
        currency: this.displayCurrency,
        amount: 0,
        missingCurrencies: [],
      };
    }

    const rates = await this.getRates();
    let total = 0;
    const missing = [];

    for (const entry of byCurrency) {
      const currency = String(entry.currency || "").toUpperCase();
      const amount = Number(entry.amount) || 0;

      if (!amount) {
        continue;
      }

      if (!currency || currency === "UNKNOWN") {
        missing.push(currency || "UNKNOWN");
        continue;
      }

      if (currency === this.displayCurrency) {
        total += amount;
        continue;
      }

      const rate = Number(rates[currency]);
      if (!Number.isFinite(rate) || rate <= 0) {
        missing.push(currency);
        continue;
      }

      // API rates are 1 displayCurrency -> targetCurrency.
      total += amount / rate;
    }

    return {
      currency: this.displayCurrency,
      amount: roundMoney(total),
      missingCurrencies: Array.from(new Set(missing)),
    };
  }

  async getRates() {
    const cached = this.cacheStore.getFxRates(this.displayCurrency);
    if (cached && Date.now() - cached.fetchedAt < FX_CACHE_TTL_MS && cached.rates) {
      return cached.rates;
    }

    try {
      const response = await fetch(`${this.fxApiBaseUrl}/${this.displayCurrency}`);
      if (!response.ok) {
        throw new Error(`FX API failed: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      const rates = payload?.rates;

      if (!rates || typeof rates !== "object") {
        throw new Error("FX API returned invalid rates payload");
      }

      const normalizedRates = normalizeRates(rates);
      normalizedRates[this.displayCurrency] = 1;
      this.cacheStore.saveFxRates(this.displayCurrency, normalizedRates, Date.now());
      return normalizedRates;
    } catch {
      if (cached?.rates) {
        return cached.rates;
      }

      return { [this.displayCurrency]: 1 };
    }
  }
}

function normalizeRates(input) {
  const output = {};

  for (const [currency, value] of Object.entries(input || {})) {
    const code = String(currency || "").trim().toUpperCase();
    const numeric = Number(value);
    if (!code || !Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }

    output[code] = numeric;
  }

  return output;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

module.exports = {
  FxService,
};
