/** Manages the Cesium entities used to display ground-station coverage heat maps. */
export function createGroundStationHeatMapManager({
    viewer,
    Cesium,
    groundStationLayers,
    getActiveSatelliteLayerIds,
    getSatelliteTelemetry,
    calculateElevationDegrees,
    calculateGeoDistanceKm,
    normalizeDensity,
    onChange
}) {
    const entitiesByStation = new Map();

    function notifyChange() {
        onChange?.();
    }

    function clear(layerId) {
        for (const entity of entitiesByStation.get(layerId) || []) {
            viewer.entities.remove(entity);
        }
        entitiesByStation.delete(layerId);
        notifyChange();
    }

    function update(layerId) {
        const station = groundStationLayers.get(layerId);
        if (!station || station.visible !== true || station.heatmap_enabled === false) {
            clear(layerId);
            return;
        }

        const satelliteIds = getActiveSatelliteLayerIds().slice(0, 80);
        clear(layerId);
        const entities = [];
        const coverageRadiusKm = Math.max(100, Number(station.coverage_radius_km) || 1200);
        const density = normalizeDensity(station.heatmap_density);
        const densityFactor = density === "high" ? 0.4 : (density === "low" ? 2.2 : 1);
        const baseStep = Math.max(0.22, Math.min(1.2, coverageRadiusKm / 1700));
        const step = Math.max(0.08, Math.min(2.2, baseStep * densityFactor));
        const gridRadius = Math.max(4, Math.min(26, Math.ceil(Math.max(step, coverageRadiusKm / 111) / step)));
        const height = Math.max(12000, Number(station.altitude_m) + 12000);
        const pixelSize = density === "high" ? 7 : (density === "low" ? 4 : 5);

        for (let y = -gridRadius; y <= gridRadius; y += 1) {
            for (let x = -gridRadius; x <= gridRadius; x += 1) {
                const latitude = station.latitude_deg + (y * step);
                const rawLongitude = station.longitude_deg + (x * step);
                if (latitude < -89.9 || latitude > 89.9) continue;

                const longitude = rawLongitude > 180 ? rawLongitude - 360 : (rawLongitude < -180 ? rawLongitude + 360 : rawLongitude);
                if (calculateGeoDistanceKm(station.latitude_deg, station.longitude_deg, latitude, longitude) > coverageRadiusKm) continue;

                const groundPosition = Cesium.Cartesian3.fromDegrees(longitude, latitude, 0);
                const covered = satelliteIds.some((satelliteId) => {
                    const geo = getSatelliteTelemetry(satelliteId)?.geo;
                    if (!geo) return false;
                    const satellitePosition = Cesium.Cartesian3.fromDegrees(Number(geo.longitude_deg) || 0, Number(geo.latitude_deg) || 0, Number(geo.altitude_m) || 0);
                    return calculateElevationDegrees(Cesium, groundPosition, satellitePosition) >= station.min_elevation_deg;
                });

                const key = `${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
                const sample = station.heatmap_samples.get(key) || { hits: 0, total: 0 };
                sample.total += 1;
                if (covered) sample.hits += 1;
                station.heatmap_samples.set(key, sample);
                const ratio = sample.hits / sample.total;
                const color = ratio > 0.8 ? "#3af27a" : ratio > 0.55 ? "#f7d34d" : ratio > 0.3 ? "#f29a3a" : "#cc3d55";
                entities.push(viewer.entities.add({
                    id: `${layerId}-heat-${latitude.toFixed(3)}-${longitude.toFixed(3)}`,
                    position: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
                    point: { pixelSize, color: Cesium.Color.fromCssColorString(color).withAlpha(0.86), outlineColor: Cesium.Color.BLACK.withAlpha(0.35), outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
                    show: true,
                    properties: { orbitLayerId: layerId, layerType: "GROUND_STATION_HEAT" }
                }));
            }
        }

        entitiesByStation.set(layerId, entities);
        notifyChange();
    }

    function refreshAll() {
        for (const layerId of groundStationLayers.keys()) update(layerId);
        notifyChange();
    }

    function setVisible(layerId, visible) {
        for (const entity of entitiesByStation.get(layerId) || []) entity.show = visible === true;
    }

    return { clear, update, refreshAll, setVisible };
}
