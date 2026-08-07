/** Coordinates satellite, duplicate, ground-station and celestial layers behind one UI-facing API. */
export function createCompositeLayerManager({ satellites, groundStations, duplicates, names, getSatelliteSourceId, celestialBodies = null }) {
    const isCelestial = (id) => celestialBodies?.has?.(id) === true;
    const getName = (id) => names.get(id)
        || groundStations.get(id)?.name
        || celestialBodies?.getName?.(id)
        || String(id || "");
    const getIds = () => [
        ...satellites.getActiveIds(),
        ...duplicates.keys(),
        ...groundStations.keys(),
        ...(celestialBodies?.getIds?.() || [])
    ];
    const isActive = (id) => isCelestial(id) || groundStations.has(id) || duplicates.has(id) || satellites.isActive(id);
    const getVisibility = (id) => {
        if (isCelestial(id)) return celestialBodies.getVisibility(id);
        return groundStations.has(id) ? groundStations.get(id).visible === true : satellites.isVisible(getSatelliteSourceId(id));
    };
    const setVisibility = (id, visible) => {
        if (isCelestial(id)) {
            celestialBodies.setVisibility(id, visible);
            return;
        }
        if (groundStations.has(id)) {
            const station = groundStations.get(id);
            station.visible = visible === true;
            station.entity && (station.entity.show = station.visible);
            station.coverageEntity && (station.coverageEntity.show = station.visible && station.coverage_visible !== false);
            station.coverageVolumeEntity && (station.coverageVolumeEntity.show = station.visible && station.coverage_visible !== false);
            return;
        }
        satellites.setVisible(getSatelliteSourceId(id), visible);
    };
    const duplicate = (sourceId) => {
        if (!satellites.isActive(sourceId) && !satellites.setActive(sourceId, true)) return null;
        const id = `satdup:${crypto.randomUUID()}`;
        duplicates.set(id, { sourceId });
        names.set(id, `${getName(sourceId)} (${[...duplicates.values()].filter((item) => item.sourceId === sourceId).length + 1})`);
        return id;
    };
    return { getName, getIds, isActive, getVisibility, setVisibility, duplicate };
}
