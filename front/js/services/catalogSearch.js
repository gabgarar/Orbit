export function getCatalogNoradId(item) {
    const direct = String(item?.noradId || "").trim();
    if (direct) return direct;
    const fallback = String(item?.line1 || "").slice(2, 7).trim();
    return /^\d+$/.test(fallback) ? fallback : "";
}

export function createCatalogSearch({ fetchImpl = fetch }) {
    const cache = new Map();
    const search = async (query) => {
        const normalized = String(query || "").trim().toLowerCase();
        if (!normalized) return [];
        if (cache.has(normalized)) return cache.get(normalized);
        const params = new URLSearchParams({ offset: "0", limit: "15", search: normalized });
        const response = await fetchImpl(`/api/catalog/page?${params.toString()}`, { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const items = (Array.isArray(payload?.items) ? payload.items : []).map((item) => ({ name: String(item?.name || "").trim(), line1: String(item?.line1 || "").trim(), line2: String(item?.line2 || "").trim(), noradId: String(item?.noradId || "").trim() })).filter((item) => item.name);
        cache.set(normalized, items);
        return items;
    };
    return { search, clearCache: () => cache.clear() };
}
