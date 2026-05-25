const appSelect = document.getElementById("appSelect");
const daysSelect = document.getElementById("daysSelect");
const refreshBtn = document.getElementById("refreshBtn");
const downloadsTotalEl = document.getElementById("downloadsTotal");
const purchasesTotalEl = document.getElementById("purchasesTotal");
const grossSalesTotalEl = document.getElementById("grossSalesTotal");
const grossSalesMetaEl = document.getElementById("grossSalesMeta");
const proceedsTotalEl = document.getElementById("proceedsTotal");
const proceedsMetaEl = document.getElementById("proceedsMeta");
const dateRangeEl = document.getElementById("dateRange");
const topAppsPanel = document.getElementById("topAppsPanel");
const topAppsBody = document.getElementById("topAppsBody");
const statusEl = document.getElementById("status");
const chartCanvas = document.getElementById("chart");
const loadingOverlayEl = document.getElementById("loadingOverlay");
const loadingTextEl = document.getElementById("loadingText");

const numberFormatter = new Intl.NumberFormat();
const moneyFallbackFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
let appIconMap = new Map();
let loadingCounter = 0;

refreshBtn.addEventListener("click", async () => {
  await loadApps().catch(() => {});
  loadMetrics({ force: true });
});
appSelect.addEventListener("change", () => loadMetrics());
daysSelect.addEventListener("change", () => loadMetrics());

initialize().catch((error) => showStatus(error.message, true));

async function initialize() {
  setLoading(true, "Loading apps...");
  try {
    showStatus("Loading apps...");
    const apps = await loadApps();

    appSelect.innerHTML = "";
    appSelect.append(new Option("All apps", ""));

    for (const app of apps) {
      appSelect.append(new Option(`${app.name} (${app.bundleId})`, app.id));
    }

    await loadMetrics();
  } finally {
    setLoading(false);
  }
}

async function loadApps() {
  const response = await fetch("/api/apps");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Failed to load apps.");
  }

  const apps = payload.data || [];
  appIconMap = new Map(apps.map((a) => [a.id, a.iconUrl || ""]));
  return apps;
}

async function loadMetrics(options = {}) {
  const appId = appSelect.value;
  const days = daysSelect.value || "30";

  const params = new URLSearchParams({ days });
  if (options.force) {
    params.set("refresh", "1");
  }
  if (appId) {
    params.set("appId", appId);
  }

  showStatus("Loading metrics...");
  setLoading(true, "Loading metrics...");
  refreshBtn.disabled = true;

  try {
    const response = await fetch(`/api/metrics?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load metrics.");
    }

    render(payload.data);
    const selectedName = payload.data.selectedAppName || "all apps";
    showStatus(`Updated ${selectedName} (${payload.data.startDate} to ${payload.data.endDate}).`);
  } catch (error) {
    showStatus(error.message, true);
    drawEmptyChart(chartCanvas, "No data");
  } finally {
    refreshBtn.disabled = false;
    setLoading(false);
  }
}

function render(data) {
  downloadsTotalEl.textContent = formatMetric(data.totals.downloads);
  purchasesTotalEl.textContent = formatMetric(data.totals.purchases);
  renderConvertedMoneySummary(
    data?.totals?.grossSalesConverted,
    data?.totals?.grossSales,
    grossSalesTotalEl,
    grossSalesMetaEl
  );
  renderConvertedMoneySummary(
    data?.totals?.proceedsConverted,
    data?.totals?.proceeds,
    proceedsTotalEl,
    proceedsMetaEl
  );
  dateRangeEl.textContent = `${data.startDate} to ${data.endDate}`;

  drawSeriesChart(chartCanvas, data.series || []);
  renderTopApps(data);
}

function renderTopApps(data) {
  const hasSelection = Boolean(data.selectedAppId);
  topAppsPanel.style.display = hasSelection ? "none" : "block";

  if (hasSelection) {
    topAppsBody.innerHTML = "";
    return;
  }

  const rows = data.topApps || [];
  if (!rows.length) {
    topAppsBody.innerHTML = '<tr><td colspan="3">No data</td></tr>';
    return;
  }

  topAppsBody.innerHTML = rows
    .map(
      (row) =>
        `<tr><td>${renderAppNameCell(row.name, row.appId)}</td><td>${formatMetric(row.downloads)}</td><td>${formatMetric(
          row.purchases
        )}</td></tr>`
    )
    .join("");
}

function renderAppNameCell(name, appId) {
  const safeName = escapeHtml(name);
  const safeIconUrl = escapeHtml(appId ? (appIconMap.get(appId) || "") : "");
  const fallbackLetter = safeName.slice(0, 1).toUpperCase() || "?";

  if (!safeIconUrl) {
    return `<span class="app-name-cell"><span class="app-icon app-icon-fallback">${fallbackLetter}</span><span>${safeName}</span></span>`;
  }

  return `<span class="app-name-cell"><img class="app-icon" src="${safeIconUrl}" alt="" loading="lazy" decoding="async" /><span>${safeName}</span></span>`;
}

function drawSeriesChart(canvas, series) {
  if (!Array.isArray(series) || !series.length) {
    drawEmptyChart(canvas, "No data");
    return;
  }

  const labels = series.map((point) => point.date.slice(5));
  const downloads = series.map((point) => Number(point.downloads) || 0);
  const purchases = series.map((point) => Number(point.purchases) || 0);

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 900;
  const cssHeight = getCanvasCssHeight(canvas);

  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const margin = { top: 20, right: 20, bottom: 40, left: 56 };
  const chartWidth = cssWidth - margin.left - margin.right;
  const chartHeight = cssHeight - margin.top - margin.bottom;
  const yMax = Math.max(1, ...downloads, ...purchases) * 1.1;

  ctx.font = "12px IBM Plex Sans, Segoe UI, sans-serif";
  ctx.fillStyle = "#6b7280";
  ctx.strokeStyle = "#dbe2ea";
  ctx.lineWidth = 1;

  const tickCount = 4;
  for (let i = 0; i <= tickCount; i += 1) {
    const ratio = i / tickCount;
    const y = margin.top + chartHeight - ratio * chartHeight;
    const value = Math.round((ratio * yMax + Number.EPSILON) * 100) / 100;

    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + chartWidth, y);
    ctx.stroke();

    ctx.fillText(numberFormatter.format(value), 10, y + 4);
  }

  drawLine(ctx, downloads, "#0066ff", margin, chartWidth, chartHeight, yMax);
  drawLine(ctx, purchases, "#0f766e", margin, chartWidth, chartHeight, yMax);

  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top + chartHeight);
  ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight);
  ctx.stroke();

  const step = Math.max(1, Math.floor(labels.length / 6));
  for (let i = 0; i < labels.length; i += step) {
    const x =
      labels.length > 1
        ? margin.left + (i / (labels.length - 1)) * chartWidth
        : margin.left + chartWidth / 2;

    ctx.fillText(labels[i], x - 14, margin.top + chartHeight + 18);
  }

  drawLegend(ctx, margin.left + 4, 12);
}

function drawLine(ctx, values, color, margin, chartWidth, chartHeight, yMax) {
  if (!values.length) {
    return;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let i = 0; i < values.length; i += 1) {
    const x =
      values.length > 1
        ? margin.left + (i / (values.length - 1)) * chartWidth
        : margin.left + chartWidth / 2;
    const y = margin.top + chartHeight - (values[i] / yMax) * chartHeight;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

function drawLegend(ctx, x, y) {
  ctx.font = "12px IBM Plex Sans, Segoe UI, sans-serif";

  ctx.fillStyle = "#0066ff";
  ctx.fillRect(x, y - 8, 10, 10);
  ctx.fillStyle = "#1f2937";
  ctx.fillText("Downloads", x + 14, y);

  const x2 = x + 90;
  ctx.fillStyle = "#0f766e";
  ctx.fillRect(x2, y - 8, 10, 10);
  ctx.fillStyle = "#1f2937";
  ctx.fillText("Purchases", x2 + 14, y);
}

function drawEmptyChart(canvas, label) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 900;
  const cssHeight = getCanvasCssHeight(canvas);

  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#6b7280";
  ctx.font = "14px IBM Plex Sans, Segoe UI, sans-serif";
  ctx.fillText(label, 20, 30);
}

function formatMetric(value) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

function renderConvertedMoneySummary(converted, rawSummary, valueEl, metaEl) {
  const currency = String(converted?.currency || "").toUpperCase();
  const amount = Number(converted?.amount);
  if (currency && Number.isFinite(amount)) {
    valueEl.textContent = formatCurrencyAmount(currency, amount);
    const missing = Array.isArray(converted?.missingCurrencies)
      ? converted.missingCurrencies.filter(Boolean)
      : [];
    if (missing.length) {
      metaEl.textContent = `Converted to ${currency} (missing rates: ${missing.join(", ")})`;
    } else {
      metaEl.textContent = `Converted to ${currency}`;
    }
    return;
  }

  renderMoneySummary(rawSummary, valueEl, metaEl);
}

function renderMoneySummary(summary, valueEl, metaEl) {
  const byCurrency = Array.isArray(summary?.byCurrency) ? summary.byCurrency : [];
  if (!byCurrency.length) {
    valueEl.textContent = "$0.00";
    metaEl.textContent = "";
    return;
  }

  if (!summary.mixedCurrencies && byCurrency.length === 1) {
    const single = byCurrency[0];
    valueEl.textContent = formatCurrencyAmount(single.currency, single.amount);
    metaEl.textContent = single.currency === "UNKNOWN" ? "Unknown currency" : single.currency;
    return;
  }

  const primary = byCurrency[0];
  valueEl.textContent = formatCurrencyAmount(primary.currency, primary.amount);
  metaEl.textContent = `Mixed currencies (${byCurrency.length})`;
}

function formatCurrencyAmount(currency, amount) {
  const numericAmount = Number(amount) || 0;

  if (!currency || currency === "UNKNOWN") {
    return moneyFallbackFormatter.format(numericAmount);
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericAmount);
  } catch {
    return `${currency} ${moneyFallbackFormatter.format(numericAmount)}`;
  }
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b91c1c" : "#6b7280";
  statusEl.classList.toggle("status-error", isError);
}

function setLoading(isLoading, message) {
  if (!loadingOverlayEl) {
    return;
  }

  if (isLoading) {
    loadingCounter += 1;
    if (message && loadingTextEl) {
      loadingTextEl.textContent = message;
    }
  } else {
    loadingCounter = Math.max(0, loadingCounter - 1);
  }

  const visible = loadingCounter > 0;
  loadingOverlayEl.hidden = !visible;
  loadingOverlayEl.style.display = visible ? "grid" : "none";
  document.body.classList.toggle("is-loading", visible);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCanvasCssHeight(canvas) {
  const fallback = Math.floor(window.innerHeight * 0.35);
  const height = canvas.clientHeight || fallback || 240;
  return Math.max(160, Math.min(300, height));
}
