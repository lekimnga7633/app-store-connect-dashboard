# App Store Connect Dashboard

Simple web dashboard that shows daily downloads and purchases for your apps from the App Store Connect API.

## What it uses

This project uses the App Store Connect `SalesReports` endpoint:

- `GET /v1/salesReports`
- `reportType=SALES`
- `reportSubType=SUMMARY`
- `frequency=DAILY`

The backend downloads and parses daily tab-delimited GZIP reports and serves aggregated JSON for the frontend.

Dashboard metrics now include:

- Downloads
- Purchases
- Gross Sales (single converted total + original currency breakdown in API)
- Developer Proceeds (single converted total + original currency breakdown in API)

## Requirements

- Node.js 18+
- An App Store Connect API key (`.p8`)
- App Store Connect access with permission to read Sales and Trends data

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your env file:

```bash
cp .env.example .env
```

3. Fill values in `.env`:

- `ASC_ISSUER_ID`
- `ASC_KEY_ID`
- `ASC_VENDOR_NUMBER`
- `ASC_PRIVATE_KEY_PATH` (path to your `.p8` key)
- optional: `CACHE_DB_PATH` (default `./cache.sqlite`)
- optional: `DISPLAY_CURRENCY` (currency code for single-number money totals, default `USD`)
- optional: `ASC_REQUEST_TIMEOUT_MS` (default `30000`)
- optional: `ASC_SALES_REPORT_VERSION` (leave unset unless you need to pin it)

You can use `ASC_PRIVATE_KEY` instead of `ASC_PRIVATE_KEY_PATH` by putting the key text into one env var and escaping new lines with `\\n`.

Fastlane env var names are also accepted automatically:

- `APP_STORE_CONNECT_API_KEY_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_KEY_ID`
- `APP_STORE_CONNECT_API_KEY_KEY_FILEPATH` (or `..._KEY`)

4. Start the server:

```bash
npm start
```

5. Open:

`http://localhost:3000`

## API endpoints

- `GET /api/apps` - list available apps
- `GET /api/metrics?days=30&appId=<optional>` - dashboard time series + totals

`days` supports 1 to 3650.

## Caching

- Daily report aggregates are cached in SQLite (`daily_metrics_cache` table).
- Historical dates are treated as immutable and loaded from cache on next requests.
- Only recent dates are refreshed periodically to pick up late adjustments.
- FX rates are cached in SQLite (`fx_rates_cache`) and reused for currency conversion.

## Metric definitions

- `downloads`: positive `Units` rows for App Store download/update/redownload product types
- `purchases`: positive `Units` rows that have positive customer price or developer proceeds, excluding update/redownload product types

These definitions are practical approximations from the daily `SALES` summary report format.

## Troubleshooting auth

- `401 Unauthorized`: key/issuer/key content mismatch (wrong key type, wrong issuer ID, malformed `.p8`, or expired/invalid JWT).
- `403 Forbidden`: key is valid but lacks permission for Sales Reports (role/access issue).
- `400 ... version parameter ... invalid`: your account uses a different report version; this app now auto-detects and retries with the latest version.
