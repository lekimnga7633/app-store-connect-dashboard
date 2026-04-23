const zlib = require("node:zlib");
const { parse } = require("csv-parse/sync");
const UNMAPPED_APP_ID = "__UNMAPPED__";

const DOWNLOAD_PRODUCT_TYPES = new Set([
  "1",
  "1F",
  "1T",
  "1E",
  "1EP",
  "1EU",
  "F1",
]);

const UPDATE_OR_REDOWNLOAD_TYPES = new Set(["3", "3F", "7", "7F", "7T", "F7"]);

function decodeSalesReport(buffer) {
  const data = maybeGunzip(buffer);
  const text = data.toString("utf8");

  if (!text.trim()) {
    return [];
  }

  return parse(text, {
    delimiter: "\t",
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    bom: true,
    trim: true,
  });
}

function aggregateDailyMetrics(rows, options = {}) {
  const selectedAppId =
    typeof options.selectedAppId === "string" ? options.selectedAppId.trim() : "";
  const knownAppIds = options.knownAppIds instanceof Set ? options.knownAppIds : null;
  const bundleIdMatchers = Array.isArray(options.bundleIdMatchers) ? options.bundleIdMatchers : [];
  const appSkuToAppIdMap =
    options.appSkuToAppIdMap instanceof Map ? options.appSkuToAppIdMap : null;
  const appNameMatchers = Array.isArray(options.appNameMatchers) ? options.appNameMatchers : [];
  const iapToAppIdMap = options.iapToAppIdMap instanceof Map ? options.iapToAppIdMap : null;

  if (!rows.length) {
    return {
      downloads: 0,
      purchases: 0,
      grossSalesByCurrency: new Map(),
      proceedsByCurrency: new Map(),
      byApp: new Map(),
      rowCount: 0,
    };
  }

  const headers = Object.keys(rows[0]);
  const appIdField = resolveHeader(headers, [
    "Apple Identifier",
    "Apple ID",
    "App Apple ID",
    "AppleIdentifier",
  ]);
  const parentAppIdField = resolveHeader(headers, ["Parent Identifier", "ParentIdentifier"]);
  const skuField = resolveHeader(headers, ["SKU", "Sku"]);
  const parentSkuField = resolveHeader(headers, ["Parent SKU", "ParentSku"]);
  const titleField = resolveHeader(headers, ["Title", "App Name", "Product Name"]);
  const parentTitleField = resolveHeader(headers, ["Parent Title", "Parent Name"]);
  const productTypeField = resolveHeader(headers, ["Product Type Identifier", "ProductTypeIdentifier"]);
  const unitsField = resolveHeader(headers, ["Units"]);
  const customerPriceField = resolveHeader(headers, ["Customer Price", "Customer Price (per unit)"]);
  const proceedsField = resolveHeader(headers, ["Developer Proceeds", "Developer Proceeds (per unit)"]);
  const customerCurrencyField = resolveHeader(headers, [
    "Customer Currency",
    "Currency",
    "Currency Code",
  ]);
  const proceedsCurrencyField = resolveHeader(headers, [
    "Currency of Proceeds",
    "Proceeds Currency",
    "Proceeds Currency Code",
  ]);

  if (!appIdField || !productTypeField || !unitsField) {
    throw new Error(
      "Unexpected sales report format. Missing required columns (Apple Identifier, Product Type Identifier, Units)."
    );
  }

  let downloads = 0;
  let purchases = 0;
  const grossSalesByCurrency = new Map();
  const proceedsByCurrency = new Map();
  const byApp = new Map();

  for (const row of rows) {
    const primaryAppId = String(row[appIdField] || "").trim();
    const parentAppId = parentAppIdField ? String(row[parentAppIdField] || "").trim() : "";
    const sku = skuField ? String(row[skuField] || "").trim() : "";
    const parentSku = parentSkuField ? String(row[parentSkuField] || "").trim() : "";
    const title = titleField ? String(row[titleField] || "").trim() : "";
    const parentTitle = parentTitleField ? String(row[parentTitleField] || "").trim() : "";

    const appId = resolveAppId(
      {
        primaryAppId,
        parentAppId,
        sku,
        parentSku,
        title,
        parentTitle,
      },
      knownAppIds,
      bundleIdMatchers,
      appSkuToAppIdMap,
      appNameMatchers,
      iapToAppIdMap
    );
    if (!appId) {
      continue;
    }

    if (selectedAppId && appId !== selectedAppId) {
      continue;
    }

    const units = parseNumber(row[unitsField]);
    if (!Number.isFinite(units) || units <= 0) {
      continue;
    }

    const productType = String(row[productTypeField] || "").trim().toUpperCase();
    const customerPrice = customerPriceField ? parseNumber(row[customerPriceField]) : 0;
    const developerProceeds = proceedsField ? parseNumber(row[proceedsField]) : 0;

    const isDownload = DOWNLOAD_PRODUCT_TYPES.has(productType);
    const isPurchase = isPurchaseRow(productType, customerPrice, developerProceeds);

    if (!isDownload && !isPurchase) {
      continue;
    }

    const reportTitle = parentTitle || title;

    let perApp = byApp.get(appId);
    if (!perApp) {
      perApp = {
        downloads: 0,
        purchases: 0,
        title: reportTitle || "",
        grossSalesByCurrency: new Map(),
        proceedsByCurrency: new Map(),
      };
      byApp.set(appId, perApp);
    } else if (!perApp.title && reportTitle) {
      perApp.title = reportTitle;
    }

    if (isDownload) {
      downloads += units;
      perApp.downloads += units;
    }

    if (isPurchase) {
      purchases += units;
      perApp.purchases += units;

      const currency = selectCurrency(row, proceedsCurrencyField, customerCurrencyField);
      if (customerPrice > 0) {
        const grossAmount = customerPrice * units;
        addCurrencyAmount(grossSalesByCurrency, currency, grossAmount);
        addCurrencyAmount(perApp.grossSalesByCurrency, currency, grossAmount);
      }
      if (developerProceeds > 0) {
        const proceedsAmount = developerProceeds * units;
        addCurrencyAmount(proceedsByCurrency, currency, proceedsAmount);
        addCurrencyAmount(perApp.proceedsByCurrency, currency, proceedsAmount);
      }
    }
  }

  return {
    downloads,
    purchases,
    grossSalesByCurrency,
    proceedsByCurrency,
    byApp,
    rowCount: rows.length,
  };
}

function isPurchaseRow(productType, customerPrice, developerProceeds) {
  const hasPositiveValue = customerPrice > 0 || developerProceeds > 0;
  if (!hasPositiveValue) {
    return false;
  }

  if (UPDATE_OR_REDOWNLOAD_TYPES.has(productType)) {
    return false;
  }

  return true;
}

function mergePerAppTotals(targetMap, sourceMap) {
  for (const [appId, metrics] of sourceMap.entries()) {
    const current = targetMap.get(appId) || {
      downloads: 0,
      purchases: 0,
      title: "",
      grossSalesByCurrency: new Map(),
      proceedsByCurrency: new Map(),
    };
    current.downloads += metrics.downloads;
    current.purchases += metrics.purchases;
    if (!current.title && metrics.title) {
      current.title = metrics.title;
    }
    mergeCurrencyMap(current.grossSalesByCurrency, metrics.grossSalesByCurrency);
    mergeCurrencyMap(current.proceedsByCurrency, metrics.proceedsByCurrency);
    targetMap.set(appId, current);
  }
}

function resolveAppId(
  fields,
  knownAppIds,
  bundleIdMatchers,
  appSkuToAppIdMap,
  appNameMatchers,
  iapToAppIdMap
) {
  const candidateId = fields.parentAppId || fields.primaryAppId;
  if (!candidateId) {
    // Continue; the row may still be mappable via SKU/title lookup.
  }

  if (!knownAppIds || knownAppIds.size === 0) {
    return candidateId;
  }

  if (fields.parentAppId && knownAppIds.has(fields.parentAppId)) {
    return fields.parentAppId;
  }

  if (fields.primaryAppId && knownAppIds.has(fields.primaryAppId)) {
    return fields.primaryAppId;
  }

  const bundleMappedAppId = resolveByBundlePrefix(fields, bundleIdMatchers);
  if (bundleMappedAppId && knownAppIds.has(bundleMappedAppId)) {
    return bundleMappedAppId;
  }

  const skuMappedAppId = resolveBySkuLookup(fields, appSkuToAppIdMap);
  if (skuMappedAppId && knownAppIds.has(skuMappedAppId)) {
    return skuMappedAppId;
  }

  const lookedUpAppId = resolveByIapLookup(fields, iapToAppIdMap);
  if (lookedUpAppId && knownAppIds.has(lookedUpAppId)) {
    return lookedUpAppId;
  }

  const titleMappedAppId = resolveByAppTitleHeuristic(fields, appNameMatchers);
  if (titleMappedAppId && knownAppIds.has(titleMappedAppId)) {
    return titleMappedAppId;
  }

  return UNMAPPED_APP_ID;
}

function resolveByBundlePrefix(fields, bundleIdMatchers) {
  if (!bundleIdMatchers.length) {
    return "";
  }

  const sourceValues = [fields.parentSku, fields.sku, fields.parentTitle, fields.title];
  for (const sourceValue of sourceValues) {
    const candidates = extractIdentifierCandidates(sourceValue);
    for (const candidate of candidates) {
      for (const matcher of bundleIdMatchers) {
        if (candidate === matcher.bundleId || candidate.startsWith(`${matcher.bundleId}.`)) {
          return matcher.appId;
        }
      }
    }
  }

  return "";
}

function resolveBySkuLookup(fields, appSkuToAppIdMap) {
  if (!appSkuToAppIdMap || !appSkuToAppIdMap.size) {
    return "";
  }

  const parentSkuKey = normalizeLookupKey(fields.parentSku);
  if (parentSkuKey) {
    const appId = appSkuToAppIdMap.get(parentSkuKey);
    if (appId) {
      return appId;
    }
  }

  const skuKey = normalizeLookupKey(fields.sku);
  if (skuKey) {
    const appId = appSkuToAppIdMap.get(skuKey);
    if (appId) {
      return appId;
    }
  }

  return "";
}

function resolveByIapLookup(fields, iapToAppIdMap) {
  if (!iapToAppIdMap || !iapToAppIdMap.size) {
    return "";
  }

  const candidates = [
    fields.primaryAppId,
    fields.parentAppId,
    fields.parentSku,
    fields.sku,
    fields.parentTitle,
    fields.title,
  ];

  for (const candidate of candidates) {
    const key = normalizeLookupKey(candidate);
    if (!key) {
      continue;
    }

    const appId = iapToAppIdMap.get(key);
    if (appId) {
      return appId;
    }
  }

  return "";
}

function resolveByAppTitleHeuristic(fields, appNameMatchers) {
  if (!appNameMatchers.length) {
    return "";
  }

  const titles = [normalizeLookupKey(fields.parentTitle), normalizeLookupKey(fields.title)];

  for (const title of titles) {
    if (!title) {
      continue;
    }

    const matchedIds = new Set();
    for (const entry of appNameMatchers) {
      if (title.includes(entry.name)) {
        matchedIds.add(entry.appId);
      }
    }

    if (matchedIds.size === 1) {
      return Array.from(matchedIds)[0];
    }
  }

  return "";
}

function parseNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) {
    return 0;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectCurrency(row, proceedsCurrencyField, customerCurrencyField) {
  const proceedsCurrency = proceedsCurrencyField
    ? normalizeCurrencyCode(row[proceedsCurrencyField])
    : "";
  if (proceedsCurrency) {
    return proceedsCurrency;
  }

  const customerCurrency = customerCurrencyField
    ? normalizeCurrencyCode(row[customerCurrencyField])
    : "";
  if (customerCurrency) {
    return customerCurrency;
  }

  return "UNKNOWN";
}

function normalizeCurrencyCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }

  return normalized.slice(0, 10);
}

function addCurrencyAmount(map, currency, value) {
  if (!Number.isFinite(value) || value === 0) {
    return;
  }

  const key = currency || "UNKNOWN";
  const current = map.get(key) || 0;
  map.set(key, current + value);
}

function mergeCurrencyMap(targetMap, sourceMap) {
  for (const [currency, amount] of sourceMap.entries()) {
    const current = targetMap.get(currency) || 0;
    targetMap.set(currency, current + amount);
  }
}

function resolveHeader(headers, candidates) {
  const normalizedMap = new Map();

  for (const header of headers) {
    normalizedMap.set(normalizeHeader(header), header);
  }

  for (const candidate of candidates) {
    const match = normalizedMap.get(normalizeHeader(candidate));
    if (match) {
      return match;
    }
  }

  return null;
}

function normalizeHeader(value) {
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeLookupKey(value) {
  return String(value || "").trim().toLowerCase();
}

function extractIdentifierCandidates(value) {
  const raw = normalizeLookupKey(value);
  if (!raw) {
    return [];
  }

  const set = new Set([raw]);
  for (const token of raw.split(/[\s,;|()]+/)) {
    const normalized = normalizeLookupKey(token);
    if (normalized) {
      set.add(normalized);
    }
  }

  return Array.from(set);
}

function maybeGunzip(buffer) {
  if (!buffer || buffer.length < 2) {
    return buffer;
  }

  const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (!isGzip) {
    return buffer;
  }

  return zlib.gunzipSync(buffer);
}

module.exports = {
  decodeSalesReport,
  aggregateDailyMetrics,
  mergePerAppTotals,
  UNMAPPED_APP_ID,
};
