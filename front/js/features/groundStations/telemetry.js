export function createGroundStationTelemetryService({ getPasses, getSatelliteStates, getLayerName, calculateElevationDegrees, calculateFreeSpacePathLossDb }) {
    const passCache = new Map();

    async function refreshPasses(station, startDate, endDate) {
        const cached = passCache.get(station.id);
        if (cached?.loading) return;
        passCache.set(station.id, { ...cached, loading: true });
        try {
            const rows = (await Promise.all(getSatelliteStates().slice(0, 10).map(async ({ id }) => {
                const passes = await getPasses(id, station, startDate, endDate);
                return passes?.[0] ? { satellite: id, aos: passes[0].aos || "-", los: passes[0].los || "-", max_elevation_deg: Number(passes[0].max_elevation_deg) } : null;
            }))).filter(Boolean);
            passCache.set(station.id, { loading: false, updatedAt: Date.now(), rows });
        } catch {
            passCache.set(station.id, { loading: false, updatedAt: Date.now(), rows: [] });
        }
    }

    function build(station, dates) {
        const states = getSatelliteStates();
        let visible = 0; let bestElevation = null; let bestRange = null; let bestLink = null;
        for (const satellite of states) {
            const result = calculateElevationDegrees(station, satellite);
            if (!result || result.elevationDeg < station.min_elevation_deg) continue;
            visible += 1;
            const link = calculateFreeSpacePathLossDb(station.frequency_mhz, result.rangeKm);
            if (bestElevation === null || result.elevationDeg > bestElevation) {
                bestElevation = result.elevationDeg; bestRange = result.rangeKm;
                bestLink = Number.isFinite(link) ? station.tx_power_dbm + station.tx_gain_dbi + station.rx_gain_dbi - link : null;
            }
        }
        const cache = passCache.get(station.id);
        if (!cache || Date.now() - Number(cache.updatedAt || 0) > 45_000) refreshPasses(station, dates.startDate, dates.endDate);
        return { id: getLayerName(station.id), source_format: "GROUND_STATION", source_origin: "USER", station: { name: station.name, latitude_deg: station.latitude_deg, longitude_deg: station.longitude_deg, altitude_m: station.altitude_m, min_elevation_deg: station.min_elevation_deg, frequency_mhz: station.frequency_mhz, tx_power_dbm: station.tx_power_dbm, tx_gain_dbi: station.tx_gain_dbi, rx_gain_dbi: station.rx_gain_dbi, monitor_satellite_ids: [...(station.monitor_satellite_ids || [])] }, realtime: { visible_satellites: visible, active_satellites: states.length, best_elevation_deg: bestElevation, best_range_km: bestRange, best_link_dbm: bestLink }, next_passes: cache?.rows || [] };
    }
    return { build, refreshPasses };
}
