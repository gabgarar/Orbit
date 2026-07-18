export function isGroundStationLayerId(layerId) {
    return String(layerId || "").startsWith("gst:");
}

export function isSatelliteDuplicateLayerId(layerId) {
    return String(layerId || "").startsWith("satdup:");
}

export function createSatelliteSourceIdResolver(duplicateLayers) {
    return (layerId) => isSatelliteDuplicateLayerId(layerId)
        ? String(duplicateLayers.get(layerId)?.sourceId || "").trim()
        : String(layerId || "").trim();
}
