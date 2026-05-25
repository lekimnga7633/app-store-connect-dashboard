const ICON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
const ITUNES_BATCH_SIZE = 100;
const ITUNES_TIMEOUT_MS = 10000;

class IconService {
  constructor(cacheStore) {
    this.cacheStore = cacheStore;
  }

  async getIconUrls(appIds) {
    const result = new Map();
    const toFetch = [];
    const now = Date.now();

    for (const appId of appIds) {
      const cached = this.cacheStore.getAppIcon(appId);
      if (cached && now - cached.fetchedAt < ICON_CACHE_TTL_MS) {
        result.set(appId, cached.iconUrl);
      } else {
        toFetch.push(appId);
      }
    }

    if (toFetch.length === 0) {
      return result;
    }

    const { found, checked } = await fetchIconsFromItunes(toFetch);

    for (const appId of toFetch) {
      if (checked.has(appId)) {
        // iTunes responded for this chunk — cache the result (empty = legitimately no icon)
        const iconUrl = found.get(appId) || "";
        result.set(appId, iconUrl);
        this.cacheStore.saveAppIcon(appId, iconUrl);
      } else {
        // Fetch failed (network error, 429, bad JSON) — don't cache, retry next time
        result.set(appId, "");
      }
    }

    return result;
  }
}

async function fetchIconsFromItunes(appIds) {
  const found = new Map();
  const checked = new Set();
  const chunks = chunkArray(appIds, ITUNES_BATCH_SIZE);

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const ids = chunk.map(encodeURIComponent).join(",");
        const response = await fetch(`${ITUNES_LOOKUP_URL}?id=${ids}`, {
          signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS),
        });

        if (!response.ok) {
          return;
        }

        const payload = await response.json();

        // Mark after successful parse — a JSON error leaves the chunk unchecked
        for (const appId of chunk) {
          checked.add(appId);
        }

        for (const item of payload.results || []) {
          const iconUrl = item.artworkUrl100 || "";
          if (item.trackId && iconUrl) {
            found.set(String(item.trackId), iconUrl);
          }
        }
      } catch {
        // Icons are non-critical — skip on network errors or JSON parse failures.
      }
    })
  );

  return { found, checked };
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

module.exports = { IconService };
