# App Store Connect Dashboard

A self-hosted web dashboard that shows daily downloads, purchases, and revenue for all your App Store apps.

## Features

- Downloads and purchases over a configurable date range (up to 10 years back)
- Gross sales and developer proceeds, converted to a single display currency
- Per-app breakdown with app icons fetched automatically from the App Store
- SQLite cache — historical data is fetched once; only recent days are re-checked

## Requirements

- Node.js 18+
- An App Store Connect account with at least one app
- An App Store Connect API key with **Sales and Reports** access

## Creating an App Store Connect API key

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com)
2. Go to **Users and Access → Integrations → App Store Connect API**
3. Click **+** to generate a new key
4. Set the access to **Sales and Reports** (Finance role is enough; Admin works too)
5. Download the `.p8` key file — **you can only download it once**
6. Note the **Key ID** shown next to your key (e.g. `ABC123DEFG`)
7. Note the **Issuer ID** shown at the top of the page (a UUID)

To find your **Vendor Number**:

1. Go to **Payments and Financial Reports → Payments**
2. Your vendor number appears in the top-left (e.g. `12345678`)

## Setup

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/your-username/appstore-dashboard.git
cd appstore-dashboard
npm install
```

2. Copy the example env file:

```bash
cp .env.example .env
```

3. Edit `.env` and fill in your credentials:

```
ASC_ISSUER_ID=your-issuer-uuid
ASC_KEY_ID=your-key-id
ASC_VENDOR_NUMBER=your-vendor-number
ASC_PRIVATE_KEY_PATH=AuthKey_YOURKEYID.p8
```

Place your `.p8` file in the project directory (it is gitignored).

4. Start the server:

```bash
npm start
```

5. Open `http://localhost:3000`

The first load fetches historical data from App Store Connect — this may take a minute depending on how many days you request. Data is cached in `cache.sqlite` so subsequent loads are fast.

## Configuration

All configuration is via environment variables in `.env`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `ASC_ISSUER_ID` | Yes | — | Issuer ID from App Store Connect API keys page |
| `ASC_KEY_ID` | Yes | — | Key ID of your API key |
| `ASC_VENDOR_NUMBER` | Yes | — | Your vendor number from Payments and Financial Reports |
| `ASC_PRIVATE_KEY_PATH` | Yes* | — | Path to your `.p8` key file |
| `ASC_PRIVATE_KEY` | Yes* | — | Inline key contents (alternative to `_PATH`, escape newlines as `\\n`) |
| `DISPLAY_CURRENCY` | No | `USD` | Currency code for converted money totals |
| `PORT` | No | `3000` | Port to run the server on |
| `CACHE_DB_PATH` | No | `./cache.sqlite` | Path to the SQLite cache file |
| `ASC_REQUEST_TIMEOUT_MS` | No | `30000` | Timeout for App Store Connect API requests |
| `ASC_SALES_REPORT_VERSION` | No | auto | Pin to a specific report version (leave unset) |

*Provide either `ASC_PRIVATE_KEY_PATH` or `ASC_PRIVATE_KEY`.

### Fastlane users

If you already have Fastlane credentials set up, the following env var names are also accepted:

- `APP_STORE_CONNECT_API_KEY_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_KEY_ID`
- `APP_STORE_CONNECT_API_KEY_KEY_FILEPATH` (or `APP_STORE_CONNECT_API_KEY_KEY`)

## Troubleshooting

**401 Unauthorized** — The key ID, issuer ID, or key contents do not match. Double-check all three values and make sure the `.p8` file is the one that corresponds to the Key ID in your `.env`.

**403 Forbidden** — The key is valid but does not have permission to read Sales Reports. Go to Users and Access in App Store Connect and verify the key has the **Sales and Reports** role.

**400 — version parameter invalid** — Your account uses a non-default report version. The app detects and retries with the correct version automatically.

**No data for recent days** — App Store Connect typically publishes the previous day's report several hours into the next day (UTC). If today's data is missing, check back later.

## API

The server exposes two endpoints used by the frontend:

- `GET /api/apps` — list of apps with names, bundle IDs, and icon URLs
- `GET /api/metrics?days=30&appId=<optional>` — time series and totals; `days` accepts 1–3650

## Metric definitions

- **Downloads** — positive units for first-time installs (product types 1, 1F, 1T, 1E, 1EP, 1EU, F1). Updates and re-downloads are excluded.
- **Purchases** — positive units with a positive customer price or developer proceeds, excluding update/redownload product types.
- **Gross Sales** — sum of customer price × units for purchase rows, per currency.
- **Developer Proceeds** — sum of developer proceeds × units for purchase rows, per currency.

These are practical approximations derived from the daily `SALES` summary report format.
