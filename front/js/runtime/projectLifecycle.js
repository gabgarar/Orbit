import { buildProjectDocument, isProjectDocument, normalizeProjectName } from "./projectDocument.js";
import { downloadProjectDocument, readProjectDocument, saveProjectDocument } from "./projectFileIO.js";

const GROUND_STATION_RUNTIME_FIELDS = new Set([
    "entity",
    "coverageEntity",
    "coverageVolumeEntity",
    "patternEntity",
    "patternMeshEntity",
    "patternMeshSignature",
    "patternPrimitive",
    "pointingConeEntity"
]);

function serializeGroundStation(station) {
    if (!station || typeof station !== "object" || Array.isArray(station)) {
        return null;
    }
    // Cesium entities belong to the live scene, not to an .orbit project.
    // Keep every authored RF field (including future additions) while
    // explicitly dropping renderer handles that cannot be JSON serialized.
    return Object.fromEntries(Object.entries(station)
        .filter(([key]) => !GROUND_STATION_RUNTIME_FIELDS.has(key)));
}

function normalizeRestorationIdMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return Object.fromEntries(Object.entries(value)
        .filter(([sourceId, targetId]) => String(sourceId || "").trim() && String(targetId || "").trim())
        .map(([sourceId, targetId]) => [String(sourceId), String(targetId)]));
}

function remapLayerNames(layerNames, idMap) {
    if (!layerNames || typeof layerNames !== "object" || Array.isArray(layerNames)) {
        return {};
    }
    return Object.fromEntries(Object.entries(layerNames)
        .map(([layerId, name]) => [idMap[layerId] || layerId, name]));
}

function remapLayerTree(snapshot, idMap) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Object.keys(idMap).length) {
        return snapshot;
    }
    const layerParents = snapshot.layerParents && typeof snapshot.layerParents === "object" && !Array.isArray(snapshot.layerParents)
        ? Object.fromEntries(Object.entries(snapshot.layerParents)
            .map(([layerId, folderId]) => [idMap[layerId] || layerId, folderId]))
        : snapshot.layerParents;
    return { ...snapshot, layerParents };
}

function normalizeSatelliteRestoreDisposition(value) {
    const disposition = String(value || "").trim().toLowerCase();
    return ["restore", "defer", "skip"].includes(disposition) ? disposition : "restore";
}

export function createProjectLifecycle(deps) {
    const {
        getProjectName, setProjectName, getProjectFileHandle, setProjectFileHandle,
        getActiveSatelliteIds, setAllSatelliteLayersActive, setSatelliteLayerActive,
        getGroundStationLayers, removeGroundStationLayer, clearDuplicateLayers,
        getLayerNameOverrides, clearSatelliteVisualizationConfigs, getObjectSidebar,
        getSimulationState, getMasterTimeRange = () => null, clearMasterTimeRange = () => {}, applySimulationRange, restoreSimulation = null, showConfirm, showAlert, getAlertTitle,
        getManualOrbitEntries = () => [], restoreManualOrbits = async () => ({ restored: [], failed: [] }),
        restoreGroundStations = async () => ({ restored: [], failed: [], idMap: {} }),
        getCelestialBodies = () => [], restoreCelestialBodies = () => [], clearCelestialBodies = () => {},
        // Local OEM tracks are intentionally not serialised: their samples
        // live only in the imported file/runtime. SP3 entries, by contrast,
        // can be re-registered from the server after project open.
        shouldPersistSatellite = () => true,
        shouldClearSatelliteOnProjectReset = () => false,
        getSatelliteRestoreDisposition = () => "restore",
        onSatelliteLayersRestored = () => {}
    } = deps;

    // A saved SP3 id can arrive before the optional precise-product registry
    // has hydrated. Retain only this small identifier queue (never samples or
    // source bytes) and replay it once the runtime says its metadata exists.
    const deferredSatelliteIds = new Set();

    const notifySatelliteLayersRestored = (ids, context = {}) => {
        if (!Array.isArray(ids) || !ids.length) return;
        try {
            onSatelliteLayersRestored(ids.slice(), context);
        } catch {
            // Project restoration is still useful if a presentation/runtime
            // callback cannot refresh one optional satellite representation.
        }
    };

    const restoreSatelliteIds = (ids, project = null) => {
        const restored = [];
        const deferred = [];
        const skipped = [];
        const seen = new Set();
        for (const candidate of Array.isArray(ids) ? ids : []) {
            const id = String(candidate || "").trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            let disposition = "skip";
            try {
                disposition = normalizeSatelliteRestoreDisposition(
                    getSatelliteRestoreDisposition(id, project)
                );
            } catch {
                // A failed provenance lookup must not fall through to the
                // permissive catalogue activation path during project open.
            }
            if (disposition === "skip") {
                skipped.push(id);
                continue;
            }
            if (disposition === "defer") {
                deferredSatelliteIds.add(id);
                deferred.push(id);
                continue;
            }
            if (setSatelliteLayerActive(id, true) !== false) {
                restored.push(id);
            } else {
                skipped.push(id);
            }
        }
        return { restored, deferred, skipped };
    };

    const buildDocument = () => {
        const simulation = getSimulationState();
        const authoredManualOrbits = getManualOrbitEntries();
        const manualOrbits = Array.isArray(authoredManualOrbits) ? authoredManualOrbits : [];
        const manualIds = new Set(manualOrbits
            .map((entry) => String(entry?.id || "").trim())
            .filter(Boolean));
        return buildProjectDocument({
            name: getProjectName(),
            // A manual orbit must be regenerated from its authored definition,
            // never re-subscribed as if it were a remote catalogue satellite.
            satellites: getActiveSatelliteIds().filter((id) => {
                const normalizedId = String(id || "").trim();
                return !manualIds.has(normalizedId)
                    && !normalizedId.startsWith("manual:")
                    && shouldPersistSatellite(normalizedId) !== false;
            }),
            manualOrbits,
            celestialBodies: getCelestialBodies(),
            layerNames: Object.fromEntries(getLayerNameOverrides()),
            layerTree: getObjectSidebar()?.getProjectTree?.(),
            groundStations: [...getGroundStationLayers().values()]
                .map(serializeGroundStation)
                .filter(Boolean),
            simulation: {
                mode: simulation.mode,
                startDate: simulation.startDate,
                endDate: simulation.endDate,
                currentDate: simulation.currentDate,
                isPlaying: simulation.isPlaying,
                speed: simulation.speed,
                // Store the global contract separately from the current
                // playhead/mode. A restored finite product must not derive a
                // larger/smaller scene merely from its own intrinsic range.
                masterTimeRange: getMasterTimeRange()
            }
        });
    };

    const updateTitle = () => {
        const title = getProjectName() || "My project";
        document.querySelectorAll("[data-project-title]").forEach((element) => { element.textContent = title; element.title = title; });
        window.dispatchEvent(new CustomEvent("orbit:project-title", { detail: title }));
    };

    const hasOpenProject = () => Boolean(getProjectName())
        || getActiveSatelliteIds().length > 0
        || getGroundStationLayers().size > 0
        || getCelestialBodies().length > 0
        || (getObjectSidebar()?.getProjectTree?.().folders.length || 0) > 0;

    const clearContents = () => {
        // `setAllSatelliteLayersActive(false)` deliberately keeps catalogue
        // metadata around, but an OEM's in-memory samples are local project
        // state. Remove those tracks first so a New/Open operation cannot
        // leave an invisible OEM behind or accidentally make its old id
        // serialisable in the next project.
        for (const id of getActiveSatelliteIds()) {
            if (shouldClearSatelliteOnProjectReset(String(id || "").trim()) === true) {
                setSatelliteLayerActive(id, false);
            }
        }
        deferredSatelliteIds.clear();
        setAllSatelliteLayersActive(false);
        for (const stationId of [...getGroundStationLayers().keys()]) removeGroundStationLayer(stationId);
        clearCelestialBodies(); clearDuplicateLayers(); getLayerNameOverrides().clear(); clearSatelliteVisualizationConfigs();
        getObjectSidebar()?.clearProjectTree?.(); clearMasterTimeRange(); setProjectFileHandle(null); setProjectName(null);
    };

    const startNew = (name = "Untitled project") => {
        try {
            clearContents();
        } catch {
            // Starting a blank project must not leave the user trapped behind
            // the welcome screen if stale render state cannot be cleaned up.
            showAlert("No se pudo limpiar completamente el proyecto anterior. Se ha creado uno nuevo vacio.", getAlertTitle());
        }

        setProjectName(normalizeProjectName(name));
        try {
            updateTitle();
            getObjectSidebar()?.renderList?.();
        } finally {
            window.dispatchEvent(new Event("orbit:project-opened"));
        }
        return true;
    };

    const selectFileFallback = () => new Promise((resolve) => {
        const input = document.createElement("input"); let settled = false;
        const finish = (file = null) => { if (settled) return; settled = true; input.remove(); resolve(file); };
        input.type = "file"; input.accept = ".json,application/json"; input.hidden = true;
        input.addEventListener("change", () => finish(input.files?.[0] || null), { once: true });
        window.addEventListener("focus", () => setTimeout(() => finish(), 200), { once: true });
        document.body.appendChild(input); input.click();
    });

    const loadFile = async (file, handle = null) => {
        const project = await readProjectDocument(file);
        if (!isProjectDocument(project)) throw new Error("Unsupported project file");
        if (hasOpenProject()) {
            const confirmed = await showConfirm(`Ya hay abierto el proyecto '${getProjectName() || "actual"}'. Se perderán los cambios no guardados. ¿Quieres sustituirlo?`, "Abrir otro proyecto", "Abrir proyecto");
            if (!confirmed) return false;
        }
        clearContents(); setProjectFileHandle(handle);
        setProjectName(normalizeProjectName(project.name || file.name.replace(/\.json$/i, "")));
        const manualOrbits = Array.isArray(project.manualOrbits) ? project.manualOrbits : [];
        const groundStations = Array.isArray(project.groundStations) ? project.groundStations : [];
        const manualIds = new Set(manualOrbits
            .map((entry) => String(entry?.id || "").trim())
            .filter(Boolean));
        const restoreCandidates = (project.satellites || []).filter((id) => {
            const normalizedId = String(id || "").trim();
            // Legacy project files could contain a manual: id in `satellites`.
            // It has no catalogue backing, so activating it would create a
            // dangling WebSocket/catalogue request. New files store it only in
            // `manualOrbits` and restore it below through /api/manual-orbits.
            return normalizedId && !manualIds.has(normalizedId) && !normalizedId.startsWith("manual:");
        });
        // Restore the saved simulation/MTR contract before activating any
        // finite source.  In particular, an SP3 restored after hydration
        // must be checked against the durable MTR before it can subscribe or
        // prime an exact ephemeris request.
        if (typeof restoreSimulation === "function") {
            restoreSimulation(project.simulation);
        } else if (project.simulation?.startDate && project.simulation?.endDate) {
            applySimulationRange(new Date(project.simulation.startDate), new Date(project.simulation.endDate));
        }
        const satelliteRestoration = restoreSatelliteIds(restoreCandidates, project);
        restoreCelestialBodies(project.celestialBodies);
        try {
            const restoration = await restoreManualOrbits(manualOrbits);
            if (Array.isArray(restoration?.failed) && restoration.failed.length) {
                showAlert("El proyecto se abrio, pero alguna orbita manual no pudo restaurarse.", getAlertTitle());
            }
        } catch {
            // The rest of a project remains useful if an individual saved
            // definition becomes invalid or a propagator is unavailable.
            showAlert("El proyecto se abrio, pero alguna orbita manual no pudo restaurarse.", getAlertTitle());
        }
        let groundStationIdMap = {};
        try {
            const restoration = await restoreGroundStations(groundStations);
            groundStationIdMap = normalizeRestorationIdMap(restoration?.idMap);
            if (Array.isArray(restoration?.failed) && restoration.failed.length) {
                showAlert("El proyecto se abrio, pero alguna estacion terrestre no pudo restaurarse.", getAlertTitle());
            }
        } catch {
            // Ground-station layers are local workspace data. A malformed
            // station must not prevent satellites, bodies or manual orbits
            // from opening with the rest of the project.
            showAlert("El proyecto se abrio, pero alguna estacion terrestre no pudo restaurarse.", getAlertTitle());
        }
        Object.entries(remapLayerNames(project.layerNames, groundStationIdMap))
            .forEach(([id, name]) => getLayerNameOverrides().set(id, name));
        notifySatelliteLayersRestored(satelliteRestoration.restored, {
            deferred: false,
            project,
            skipped: satelliteRestoration.skipped.slice()
        });
        if (satelliteRestoration.skipped.length) {
            showAlert("El proyecto contiene una fuente de efem\u00e9rides que no se puede restaurar sin su producto de origen. Imp\u00f3rtela de nuevo.", getAlertTitle());
        }
        getObjectSidebar()?.setProjectTree?.(remapLayerTree(project.layerTree, groundStationIdMap)); updateTitle(); getObjectSidebar()?.renderList?.();
        window.dispatchEvent(new Event("orbit:project-opened")); return true;
    };

    const restoreDeferredSatelliteLayers = () => {
        if (!deferredSatelliteIds.size) {
            return { restored: [], deferred: [], skipped: [] };
        }
        const pending = [...deferredSatelliteIds];
        deferredSatelliteIds.clear();
        const restoration = restoreSatelliteIds(pending);
        notifySatelliteLayersRestored(restoration.restored, {
            deferred: true,
            skipped: restoration.skipped.slice()
        });
        return restoration;
    };

    const saveToHandle = async (handle) => saveProjectDocument(handle, buildDocument());
    const exportProject = async () => downloadProjectDocument(buildDocument());
    const openProject = async () => { try { let handle = null; let file = null; if (window.showOpenFilePicker) { [handle] = await window.showOpenFilePicker({ types: [{ description: "Orbit project", accept: { "application/json": [".json"] } }] }); file = await handle.getFile(); } else { file = await selectFileFallback(); if (!file) return; } await loadFile(file, handle); } catch (error) { if (error?.name !== "AbortError") showAlert("No se pudo abrir el proyecto.", getAlertTitle()); } };
    return { buildDocument, updateTitle, hasOpenProject, clearContents, startNew, loadFile, restoreDeferredSatelliteLayers, openProject, saveToHandle, exportProject, getProjectFileHandle };
}
