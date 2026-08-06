import { buildProjectDocument, isProjectDocument, normalizeProjectName } from "./projectDocument.js";
import { downloadProjectDocument, readProjectDocument, saveProjectDocument } from "./projectFileIO.js";

export function createProjectLifecycle(deps) {
    const {
        getProjectName, setProjectName, getProjectFileHandle, setProjectFileHandle,
        getActiveSatelliteIds, setAllSatelliteLayersActive, setSatelliteLayerActive,
        getGroundStationLayers, removeGroundStationLayer, clearDuplicateLayers,
        getLayerNameOverrides, clearSatelliteVisualizationConfigs, getObjectSidebar,
        getSimulationState, applySimulationRange, restoreSimulation = null, showConfirm, showAlert, getAlertTitle,
        getManualOrbitEntries = () => [], restoreManualOrbits = async () => ({ restored: [], failed: [] }),
        getCelestialBodies = () => [], restoreCelestialBodies = () => [], clearCelestialBodies = () => {}
    } = deps;

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
                return !manualIds.has(normalizedId) && !normalizedId.startsWith("manual:");
            }),
            manualOrbits,
            celestialBodies: getCelestialBodies(),
            layerNames: Object.fromEntries(getLayerNameOverrides()),
            layerTree: getObjectSidebar()?.getProjectTree?.(),
            groundStations: [...getGroundStationLayers().values()].map(({ entity: _entity, coverageEntity: _coverageEntity, ...station }) => station),
            simulation: {
                mode: simulation.mode,
                startDate: simulation.startDate,
                endDate: simulation.endDate,
                currentDate: simulation.currentDate,
                isPlaying: simulation.isPlaying,
                speed: simulation.speed
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
        setAllSatelliteLayersActive(false);
        for (const stationId of [...getGroundStationLayers().keys()]) removeGroundStationLayer(stationId);
        clearCelestialBodies(); clearDuplicateLayers(); getLayerNameOverrides().clear(); clearSatelliteVisualizationConfigs();
        getObjectSidebar()?.clearProjectTree?.(); setProjectFileHandle(null); setProjectName(null);
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
        Object.entries(project.layerNames || {}).forEach(([id, name]) => getLayerNameOverrides().set(id, name));
        const manualOrbits = Array.isArray(project.manualOrbits) ? project.manualOrbits : [];
        const manualIds = new Set(manualOrbits
            .map((entry) => String(entry?.id || "").trim())
            .filter(Boolean));
        for (const id of project.satellites || []) {
            const normalizedId = String(id || "").trim();
            // Legacy project files could contain a manual: id in `satellites`.
            // It has no catalogue backing, so activating it would create a
            // dangling WebSocket/catalogue request. New files store it only in
            // `manualOrbits` and restore it below through /api/manual-orbits.
            if (!normalizedId || manualIds.has(normalizedId) || normalizedId.startsWith("manual:")) {
                continue;
            }
            setSatelliteLayerActive(normalizedId, true);
        }
        if (typeof restoreSimulation === "function") {
            restoreSimulation(project.simulation);
        } else if (project.simulation?.startDate && project.simulation?.endDate) {
            applySimulationRange(new Date(project.simulation.startDate), new Date(project.simulation.endDate));
        }
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
        getObjectSidebar()?.setProjectTree?.(project.layerTree); updateTitle(); getObjectSidebar()?.renderList?.();
        window.dispatchEvent(new Event("orbit:project-opened")); return true;
    };

    const saveToHandle = async (handle) => saveProjectDocument(handle, buildDocument());
    const exportProject = async () => downloadProjectDocument(buildDocument());
    const openProject = async () => { try { let handle = null; let file = null; if (window.showOpenFilePicker) { [handle] = await window.showOpenFilePicker({ types: [{ description: "Orbit project", accept: { "application/json": [".json"] } }] }); file = await handle.getFile(); } else { file = await selectFileFallback(); if (!file) return; } await loadFile(file, handle); } catch (error) { if (error?.name !== "AbortError") showAlert("No se pudo abrir el proyecto.", getAlertTitle()); } };
    return { buildDocument, updateTitle, hasOpenProject, clearContents, startNew, loadFile, openProject, saveToHandle, exportProject, getProjectFileHandle };
}
