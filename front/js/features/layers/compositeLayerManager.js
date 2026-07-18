/** Coordinates satellite, duplicate and ground-station layers behind one UI-facing API. */
export function createCompositeLayerManager({ satellites, groundStations, duplicates, names, getSatelliteSourceId }) {
    const getName = (id) => names.get(id) || groundStations.get(id)?.name || String(id || "");
    const getIds = () => [...satellites.getActiveIds(), ...duplicates.keys(), ...groundStations.keys()];
    const isActive = (id) => groundStations.has(id) || duplicates.has(id) || satellites.isActive(id);
    const getVisibility = (id) => groundStations.has(id) ? groundStations.get(id).visible === true : satellites.isVisible(getSatelliteSourceId(id));
    const setVisibility = (id, visible) => {
        if (groundStations.has(id)) {
            const station = groundStations.get(id);
            station.visible = visible === true;
            station.entity && (station.entity.show = station.visible);
            station.coverageEntity && (station.coverageEntity.show = station.visible && station.coverage_visible !== false);
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
