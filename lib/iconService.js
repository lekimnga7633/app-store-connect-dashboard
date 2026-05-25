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

    const fetched = await fetchIconsFromItunes(toFetch);

    for (const appId of toFetch) {
      const iconUrl = fetched.get(appId) || "";
      result.set(appId, iconUrl);
      this.cacheStore.saveAppIcon(appId, iconUrl);
    }

    return result;
  }
}

async function fetchIconsFromItunes(appIds) {
  const result = new Map();
  const chunks = chunkArray(appIds, ITUNES_BATCH_SIZE);

  for (const chunk of chunks) {
    try {
      const url = `${ITUNES_LOOKUP_URL}?id=${chunk.join(",")}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS),
      });

      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      for (const item of payload.results || []) {
        const trackId = item.trackId || item.bundleId;
        const iconUrl = item.artworkUrl100 || "";
        if (trackId && iconUrl) {
          result.set(String(trackId), iconUrl);
        }
      }
    } catch {
      // Icons are non-critical — skip silently on network errors.
    }
  }

  return result;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

module.exports = { IconService };
