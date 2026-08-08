export function createGroundStationTelemetryService({
    getPasses,
    getSatelliteStates,
    getLayerName,
    calculateElevationDegrees,
    calculatePlanningLink,
    calculateSatelliteDownlink,
    calculateRfModel
}) {
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
        let visible = 0;
        let bestElevation = null;
        let bestRange = null;
        let bestLink = null;
        let bestLinkMargin = null;
        let bestSnr = null;
        let bestSatelliteLinkStatus = "satellite-rf-profile-required";
        for (const satellite of states) {
            const result = calculateElevationDegrees(station, satellite);
            const planningLink = result ? calculatePlanningLink(station, result.rangeKm, {
                azimuthDeg: result.azimuthDeg,
                elevationDeg: result.elevationDeg
            }) : null;
            const actualLink = result && typeof calculateSatelliteDownlink === "function"
                ? calculateSatelliteDownlink(station, satellite.rf_profile, result.rangeKm, {
                    azimuthDeg: result.azimuthDeg,
                    elevationDeg: result.elevationDeg
                })
                : null;
            const fieldOfRegardIsUsable = planningLink?.field_of_regard?.usable !== false;
            const linkIsUsable = actualLink?.available === true
                ? actualLink.usable === true && fieldOfRegardIsUsable
                : planningLink?.usable === true;
            if (!result || result.elevationDeg < station.min_elevation_deg || !linkIsUsable) continue;
            visible += 1;
            if (bestElevation === null || result.elevationDeg > bestElevation) {
                bestElevation = result.elevationDeg;
                bestRange = result.rangeKm;
                bestLink = actualLink?.available === true
                    ? actualLink.received_power_dbm ?? null
                    : planningLink?.received_power_dbm ?? null;
                bestLinkMargin = actualLink?.available === true
                    ? actualLink.link_margin_db ?? null
                    : planningLink?.link_margin_db ?? null;
                bestSnr = actualLink?.available === true ? actualLink.snr_db ?? null : null;
                bestSatelliteLinkStatus = actualLink?.available === true
                    ? "available"
                    : actualLink?.reason || "satellite-rf-profile-required";
            }
        }
        const cache = passCache.get(station.id);
        if (!cache || Date.now() - Number(cache.updatedAt || 0) > 45_000) refreshPasses(station, dates.startDate, dates.endDate);
        const rf = calculateRfModel(station);
        return {
            id: getLayerName(station.id),
            source_format: "GROUND_STATION",
            source_origin: "USER",
            station: {
                name: station.name,
                latitude_deg: station.latitude_deg,
                longitude_deg: station.longitude_deg,
                altitude_m: station.altitude_m,
                time_zone: station.time_zone || "UTC",
                min_elevation_deg: station.min_elevation_deg,
                frequency_mhz: rf.frequency_mhz,
                frequency_hz: rf.frequency_mhz * 1e6,
                tx_power_dbm: rf.tx_power_dbm,
                tx_power_w: rf.tx_power_w,
                tx_gain_dbi: rf.tx_gain_dbi,
                rx_gain_dbi: rf.rx_gain_dbi,
                polarization: rf.polarization,
                operation_mode: rf.operation_mode,
                radio_range_km: rf.max_range_km,
                operational_radio_range_km: rf.operational_range_km,
                visual_radio_range_km: rf.visual_range_km,
                ground_footprint_radius_km: rf.ground_footprint_radius_km,
                rf
            },
            realtime: {
                visible_satellites: visible,
                active_satellites: states.length,
                best_elevation_deg: bestElevation,
                best_range_km: bestRange,
                best_link_dbm: bestLink,
                best_link_margin_db: bestLinkMargin,
                best_snr_db: bestSnr,
                snr_status: bestSatelliteLinkStatus
            },
            next_passes: cache?.rows || []
        };
    }
    return { build, refreshPasses };
}
