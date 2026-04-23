const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const API_BASE_URL = "https://api.appstoreconnect.apple.com";

class AppStoreConnectClient {
  constructor(config) {
    this.issuerId = config.issuerId;
    this.keyId = config.keyId;
    this.vendorNumber = config.vendorNumber;
    this.privateKey = config.privateKey;
    this.salesReportVersion = config.salesReportVersion;
    this.requestTimeoutMs = normalizeTimeout(config.requestTimeoutMs);
    this.discoveredSalesReportVersion = "";

    if (!this.issuerId || !this.keyId || !this.vendorNumber || !this.privateKey) {
      throw new Error(
        "Missing App Store Connect credentials. Set ASC_ISSUER_ID, ASC_KEY_ID, ASC_VENDOR_NUMBER and ASC_PRIVATE_KEY(_PATH)."
      );
    }

    if (!this.privateKey.includes("BEGIN PRIVATE KEY")) {
      throw new Error(
        "ASC private key is not a valid .p8 private key. Use an App Store Connect API key and ensure the key contents/path are correct."
      );
    }

    this.cachedToken = null;
    this.cachedTokenExp = 0;
  }

  static fromEnv() {
    const privateKey = readPrivateKey();

    return new AppStoreConnectClient({
      issuerId: readEnv(["ASC_ISSUER_ID", "APP_STORE_CONNECT_API_KEY_ISSUER_ID"]),
      keyId: readEnv(["ASC_KEY_ID", "APP_STORE_CONNECT_API_KEY_KEY_ID"]),
      vendorNumber: readEnv(["ASC_VENDOR_NUMBER"]),
      privateKey,
      salesReportVersion: readEnv(["ASC_SALES_REPORT_VERSION"]),
      requestTimeoutMs: readEnv(["ASC_REQUEST_TIMEOUT_MS"]),
    });
  }

  async listApps() {
    const apps = [];
    let nextUrl = this.buildUrl("/v1/apps", {
      "fields[apps]": "name,bundleId,sku",
      limit: "200",
      sort: "name",
    });

    while (nextUrl) {
      const payload = await this.requestJsonByUrl(nextUrl);
      const data = Array.isArray(payload.data) ? payload.data : [];

      for (const item of data) {
        apps.push({
          id: String(item.id),
          name: item.attributes?.name || "Unknown App",
          bundleId: item.attributes?.bundleId || "",
          sku: item.attributes?.sku || "",
        });
      }

      nextUrl = payload.links?.next || null;
    }

    apps.sort((a, b) => a.name.localeCompare(b.name));
    return apps;
  }

  async listInAppPurchasesV2ForApp(appId) {
    const items = [];
    let nextUrl = this.buildUrl(`/v1/apps/${appId}/inAppPurchasesV2`, {
      "fields[inAppPurchases]": "name,productId",
      limit: "200",
    });

    while (nextUrl) {
      const payload = await this.requestJsonByUrl(nextUrl);
      const data = Array.isArray(payload.data) ? payload.data : [];

      for (const item of data) {
        items.push({
          id: String(item.id || "").trim(),
          name: String(item.attributes?.name || "").trim(),
          productId: String(item.attributes?.productId || "").trim(),
          appId: String(appId),
        });
      }

      nextUrl = payload.links?.next || null;
    }

    return items;
  }

  async listInAppPurchasesLegacyForApp(appId) {
    const items = [];
    let nextUrl = this.buildUrl(`/v1/apps/${appId}/inAppPurchases`, {
      "fields[inAppPurchases]": "referenceName,productId",
      limit: "200",
    });

    while (nextUrl) {
      const payload = await this.requestJsonByUrl(nextUrl);
      const data = Array.isArray(payload.data) ? payload.data : [];

      for (const item of data) {
        items.push({
          id: String(item.id || "").trim(),
          name: String(item.attributes?.referenceName || "").trim(),
          productId: String(item.attributes?.productId || "").trim(),
          appId: String(appId),
        });
      }

      nextUrl = payload.links?.next || null;
    }

    return items;
  }

  async downloadDailySalesSummary(reportDate) {
    const baseQuery = {
      "filter[vendorNumber]": this.vendorNumber,
      "filter[reportType]": "SALES",
      "filter[reportSubType]": "SUMMARY",
      "filter[frequency]": "DAILY",
      "filter[reportDate]": reportDate,
    };
    const headers = { Accept: "application/a-gzip" };

    const versionsToTry = dedupe([
      this.salesReportVersion,
      this.discoveredSalesReportVersion,
      "",
    ]);

    let lastError = null;

    for (const version of versionsToTry) {
      try {
        const query = { ...baseQuery };
        if (version) {
          query["filter[version]"] = version;
        }

        return await this.requestBuffer("/v1/salesReports", { query, headers });
      } catch (error) {
        lastError = error;

        const suggestedVersion = extractLatestSalesReportVersion(error.message || "");
        if (suggestedVersion && suggestedVersion !== version) {
          this.discoveredSalesReportVersion = suggestedVersion;
          try {
            return await this.requestBuffer("/v1/salesReports", {
              query: { ...baseQuery, "filter[version]": suggestedVersion },
              headers,
            });
          } catch (retryError) {
            lastError = retryError;
          }
        }
      }
    }

    throw lastError || new Error("Failed to download App Store Connect sales report.");
  }

  async requestJson(pathname, options = {}) {
    const url = this.buildUrl(pathname, options.query);
    return this.requestJsonByUrl(url, options);
  }

  async requestJsonByUrl(url, options = {}) {
    const response = await this.request(url, {
      method: options.method,
      body: options.body,
      headers: options.headers,
    });

    if (!response.ok) {
      throw await this.buildApiError(response);
    }

    return response.json();
  }

  async requestBuffer(pathname, options = {}) {
    const url = this.buildUrl(pathname, options.query);
    const response = await this.request(url, {
      method: options.method,
      body: options.body,
      headers: options.headers,
    });

    if (!response.ok) {
      throw await this.buildApiError(response);
    }

    const data = await response.arrayBuffer();
    return Buffer.from(data);
  }

  async request(url, options = {}) {
    const token = this.getAuthToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    };

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      return await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        const timeoutError = new Error(
          `App Store Connect request timed out after ${this.requestTimeoutMs}ms`
        );
        timeoutError.status = 504;
        throw timeoutError;
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  getAuthToken() {
    const now = Math.floor(Date.now() / 1000);

    if (this.cachedToken && now < this.cachedTokenExp - 30) {
      return this.cachedToken;
    }

    // Keep token lifetime short to reduce issues from local clock skew.
    const iat = now - 5;
    const exp = now + 10 * 60;
    this.cachedToken = jwt.sign(
      {
        iss: this.issuerId,
        aud: "appstoreconnect-v1",
        iat,
        exp,
      },
      this.privateKey,
      {
        algorithm: "ES256",
        header: {
          alg: "ES256",
          kid: this.keyId,
          typ: "JWT",
        },
      }
    );
    this.cachedTokenExp = exp;

    return this.cachedToken;
  }

  buildUrl(pathname, query = {}) {
    const url = new URL(pathname, API_BASE_URL);

    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      if (Array.isArray(value)) {
        if (!value.length) {
          continue;
        }
        url.searchParams.set(key, value.join(","));
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  async buildApiError(response) {
    let message = `App Store Connect request failed: ${response.status} ${response.statusText}`;

    try {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        const detail = payload?.errors?.[0]?.detail;
        if (detail) {
          message = `${message} - ${detail}`;
        }
      } else {
        const text = await response.text();
        if (text) {
          message = `${message} - ${text.slice(0, 500)}`;
        }
      }
    } catch {
      // Keep default message on parse errors.
    }

    const error = new Error(message);
    error.status = response.status;
    return error;
  }
}

function readPrivateKey() {
  const inlineKey = readEnv(["ASC_PRIVATE_KEY", "APP_STORE_CONNECT_API_KEY_KEY"]);
  if (inlineKey) {
    return normalizePrivateKey(inlineKey.replace(/\\n/g, "\n"));
  }

  const candidatePath = readEnv(["ASC_PRIVATE_KEY_PATH", "APP_STORE_CONNECT_API_KEY_KEY_FILEPATH"]);
  if (!candidatePath) {
    return "";
  }

  const resolvedPath = path.isAbsolute(candidatePath)
    ? candidatePath
    : path.join(process.cwd(), candidatePath);

  return normalizePrivateKey(fs.readFileSync(resolvedPath, "utf8"));
}

function readEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (!value) {
      continue;
    }

    const normalized = stripWrappingQuotes(String(value).trim());
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizePrivateKey(value) {
  return value.replace(/\r/g, "").trim();
}

function extractLatestSalesReportVersion(message) {
  const match = String(message).match(/latest version for this report is\s+([0-9]+_[0-9]+)/i);
  return match?.[1] || "";
}

function normalizeTimeout(value) {
  const fallback = 30000;
  const parsed = Number.parseInt(String(value || ""), 10);

  if (!Number.isFinite(parsed) || parsed < 1000) {
    return fallback;
  }

  return parsed;
}

function dedupe(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

module.exports = {
  AppStoreConnectClient,
};
