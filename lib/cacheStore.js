const path = require("node:path");
const Database = require("better-sqlite3");

const DAILY_METRICS_CACHE_VERSION = 3;

class CacheStore {
  constructor(options = {}) {
    const dbPath = options.dbPath || path.join(process.cwd(), "cache.sqlite");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.initSchema();

    this.selectDailyStmt = this.db.prepare(
      "SELECT fetched_at, payload_json FROM daily_metrics_cache WHERE report_date = ? AND version = ?"
    );
    this.upsertDailyStmt = this.db.prepare(
      `INSERT INTO daily_metrics_cache (report_date, version, fetched_at, payload_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(report_date)
       DO UPDATE SET
         version = excluded.version,
         fetched_at = excluded.fetched_at,
         payload_json = excluded.payload_json`
    );

    this.selectFxStmt = this.db.prepare(
      "SELECT fetched_at, rates_json FROM fx_rates_cache WHERE base_currency = ?"
    );
    this.upsertFxStmt = this.db.prepare(
      `INSERT INTO fx_rates_cache (base_currency, fetched_at, rates_json)
       VALUES (?, ?, ?)
       ON CONFLICT(base_currency)
       DO UPDATE SET
         fetched_at = excluded.fetched_at,
         rates_json = excluded.rates_json`
    );
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_metrics_cache (
        report_date TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fx_rates_cache (
        base_currency TEXT PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        rates_json TEXT NOT NULL
      );
    `);
  }

  getDailyMetrics(reportDate, version) {
    const row = this.selectDailyStmt.get(reportDate, version);
    if (!row) {
      return null;
    }

    return {
      fetchedAt: Number(row.fetched_at),
      payload: safeParseJson(row.payload_json, null),
    };
  }

  saveDailyMetrics(reportDate, version, payload, fetchedAt = Date.now()) {
    this.upsertDailyStmt.run(reportDate, version, fetchedAt, JSON.stringify(payload));
  }

  getFxRates(baseCurrency) {
    const row = this.selectFxStmt.get(baseCurrency);
    if (!row) {
      return null;
    }

    return {
      fetchedAt: Number(row.fetched_at),
      rates: safeParseJson(row.rates_json, null),
    };
  }

  saveFxRates(baseCurrency, rates, fetchedAt = Date.now()) {
    this.upsertFxStmt.run(baseCurrency, fetchedAt, JSON.stringify(rates));
  }
}

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

module.exports = {
  CacheStore,
  DAILY_METRICS_CACHE_VERSION,
};
