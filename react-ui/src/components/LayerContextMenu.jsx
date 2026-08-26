import { useEffect, useState } from "react";
import { openGroundStationExportMenu } from "./GroundStationExportMenu.jsx";
import { ActionMenuItem, ActionMenuSeparator, ActionMenuSurface } from "./ActionMenuSurface.jsx";
import { EarthIcon, GroundStationIcon, OrbitalSatelliteIcon } from "./icons.jsx";
import { getOrbitContextSubmenuPosition } from "./orbitContextMenuLayout.js";

function displayLayerName(menu) {
    return String(menu?.name || menu?.title || menu?.id || "Capa").trim() || "Capa";
}

function actionDetails({ isEarth, isCelestialBody, groundStation, visible }) {
    const visibility = {
        action: "toggle-visibility",
        label: visible === false ? "Mostrar capa" : "Ocultar capa",
        description: visible === false ? "Vuelve a mostrarla en la escena." : "La conserva en el proyecto, fuera de la escena."
    };

    if (isEarth) {
        return [
            { action: "center-view", label: "Centrar vista", description: "Mueve la cámara a la Tierra." },
            visibility,
            { action: "earth-basemap", label: "Mapa base", description: "Selecciona la cartografía de la superficie." }
        ];
    }

    if (isCelestialBody) {
        return [
            { action: "center-view", label: "Centrar vista", description: "Mueve la cámara al cuerpo." },
            visibility,
            { action: "rename", label: "Renombrar capa", description: "Cambia el nombre visible en el proyecto." },
            { action: "remove", label: "Eliminar capa", description: "La quita de este proyecto.", danger: true, separator: true }
        ];
    }

    if (groundStation) {
        return [
            { action: "center-view", label: "Centrar vista", description: "Mueve la cámara a la estación." },
            visibility,
            { action: "station", label: "Actualizar parámetros", description: "Edita ubicación, máscara y configuración RF." },
            { action: "export-station", label: "Exportar…", description: "Elige GeoJSON, KML/KMZ, GeoPackage, WKT/WKB, Orbit JSON o CSV." },
            { action: "remove", label: "Eliminar capa", description: "La quita de este proyecto.", danger: true, separator: true }
        ];
    }

    return [];
}

/**
 * Layer-tree context menu. Orbital layers intentionally use the same grouped
 * View / Ephemerides structure as a globe right-click; the runtime owns the
 * actual operations through `orbit:layer-context-action`.
 */
export default function LayerContextMenu() {
    const [menu, setMenu] = useState(null);
    const [submenu, setSubmenu] = useState(null);
    const [basemapChoices, setBasemapChoices] = useState(null);
    const [basemapPickerOpen, setBasemapPickerOpen] = useState(false);

    const close = () => {
        setMenu(null);
        setSubmenu(null);
    };

    useEffect(() => {
        const open = (event) => {
            setMenu(event.detail || null);
            setSubmenu(null);
        };
        window.addEventListener("orbit:layer-context-menu", open);
        window.addEventListener("orbit:layer-context-menu-close", close);
        return () => {
            window.removeEventListener("orbit:layer-context-menu", open);
            window.removeEventListener("orbit:layer-context-menu-close", close);
        };
    }, []);

    useEffect(() => {
        const updateBasemapState = (event) => {
            const next = event.detail || null;
            if (!next) return;
            setBasemapChoices((current) => ({
                ...current,
                ...next,
                choices: Array.isArray(next.choices) ? next.choices : current?.choices
            }));
        };
        window.addEventListener("orbit:earth-basemap-choices", updateBasemapState);
        window.addEventListener("orbit:earth-basemap-state", updateBasemapState);
        return () => {
            window.removeEventListener("orbit:earth-basemap-choices", updateBasemapState);
            window.removeEventListener("orbit:earth-basemap-state", updateBasemapState);
        };
    }, []);

    useEffect(() => {
        setBasemapPickerOpen(false);
        setBasemapChoices(null);
        setSubmenu(null);
    }, [menu?.id]);

    useEffect(() => {
        if (!menu) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === "Escape") close();
        };
        const focusSubmenu = window.requestAnimationFrame(() => {
            if (!submenu) return;
            document.querySelector(`#catalogContext${submenu}Menu [data-context-menu-action='true']`)
                ?.focus({ preventScroll: true });
        });
        document.addEventListener("pointerdown", close, { once: true });
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            window.cancelAnimationFrame(focusSubmenu);
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [menu, submenu]);

    if (!menu) return null;

    const layerType = String(menu.layerType || "").toUpperCase();
    const isEarth = menu.earth === true || layerType === "EARTH" || String(menu.id || "").toLowerCase() === "body:earth";
    const isCelestialBody = layerType === "CELESTIAL_BODY" || isEarth;
    const isGroundStation = menu.groundStation === true || layerType === "GROUND_STATION";
    const isOrbit = !isCelestialBody && !isGroundStation;
    const name = displayLayerName(menu);
    const icon = isGroundStation
        ? <GroundStationIcon />
        : (isCelestialBody ? <EarthIcon /> : <OrbitalSatelliteIcon />);
    const actions = actionDetails({
        isEarth,
        isCelestialBody,
        groundStation: isGroundStation,
        visible: menu.visible
    });
    const choices = Array.isArray(basemapChoices?.choices) ? basemapChoices.choices : [];

    const select = (action, event) => {
        if (action === "earth-basemap") {
            setBasemapPickerOpen((open) => !open);
            window.dispatchEvent(new CustomEvent("orbit:earth-basemap-request", {
                detail: { id: menu.id, source: "layer-context" }
            }));
            return;
        }
        if (action === "export-station") {
            const rect = event.currentTarget.getBoundingClientRect();
            openGroundStationExportMenu({
                stationId: menu.id,
                stationName: name,
                source: "layer-context",
                anchor: { left: rect.left, top: rect.bottom + 6 }
            });
            close();
            return;
        }
        window.dispatchEvent(new CustomEvent("orbit:layer-context-action", {
            detail: { action, id: menu.id, source: "layer" }
        }));
        close();
    };

    const chooseBasemap = (choice) => {
        const basemapId = String(choice?.id || "").trim();
        if (!basemapId || choice?.available === false) return;
        window.dispatchEvent(new CustomEvent("orbit:earth-basemap-request", {
            detail: { id: menu.id, basemapId, source: "layer-context" }
        }));
        setBasemapPickerOpen(false);
    };

    const viewPosition = getOrbitContextSubmenuPosition(menu, { level: 1, height: 236 });
    const ephemeridesPosition = getOrbitContextSubmenuPosition(menu, {
        level: 2,
        height: menu.manualOrbit === true ? 190 : 146
    });
    const visibilityTitle = menu.visible === false ? "Mostrar capa" : "Ocultar capa";
    const visibilityDescription = menu.visible === false
        ? "Vuelve a mostrarla en la escena."
        : "La conserva en el proyecto, fuera de la escena.";
    const groundTrackTitle = menu.groundTrackVisible === true ? "Ocultar Ground track" : "Mostrar Ground track";
    const groundTrackDescription = menu.groundTrackVisible === true
        ? "Oculta la proyección terrestre de la órbita."
        : "Muestra la proyección terrestre de la órbita.";

    return <>
        <ActionMenuSurface
            id="catalogContextMenu"
            className="open orbit-orbit-context-menu"
            title={name}
            icon={icon}
            left={menu.left}
            top={menu.top}
            ariaLabel={`Opciones de ${name}`}
        >
            {isOrbit ? <>
                <ActionMenuItem title="Vista" description="Cámara, visibilidad y representación de la capa." aria-haspopup="menu" aria-expanded={submenu === "View"} onClick={() => setSubmenu("View")} />
                <ActionMenuItem title="Efemérides" description="Propagación y explicación de los parámetros orbitales." aria-haspopup="menu" aria-expanded={submenu === "Ephemerides"} onClick={() => setSubmenu("Ephemerides")} />
                <ActionMenuItem title="Renombrar capa" description="Cambia el nombre visible en el proyecto." trailing={false} onClick={(event) => select("rename", event)} />
                <ActionMenuItem title="Exportar…" description="Guarda los datos disponibles de la capa." trailing={false} onClick={(event) => select("export", event)} />
                <ActionMenuSeparator />
                <ActionMenuItem title="Eliminar capa" description="La quita de este proyecto." danger trailing={false} onClick={(event) => select("remove", event)} />
            </> : <>
                {actions.map((action) => <span key={action.action}>
                    {action.separator && <ActionMenuSeparator />}
                    <ActionMenuItem
                        title={action.label}
                        description={action.description}
                        danger={action.danger === true}
                        aria-expanded={action.action === "earth-basemap" ? basemapPickerOpen : undefined}
                        onClick={(event) => select(action.action, event)}
                    />
                </span>)}
                {isEarth && basemapPickerOpen && <div className="orbit-action-menu__basemap-options" aria-label="Seleccionar mapa base">
                    <ActionMenuSeparator />
                    {choices.length ? choices.map((choice) => {
                        const id = String(choice?.id || "");
                        const selected = id && id === String(basemapChoices?.selectedId || "");
                        const unavailable = choice?.available === false;
                        const description = unavailable
                            ? (choice?.unavailableReason || "No disponible")
                            : (choice?.description || choice?.attribution || "Cartografía de la superficie.");
                        return <ActionMenuItem
                            key={id || choice?.label}
                            title={choice?.label || choice?.name || id}
                            description={description}
                            trailing={selected ? <span className="orbit-action-menu__selected" aria-label="Seleccionado">✓</span> : false}
                            className={unavailable ? "is-unavailable" : ""}
                            disabled={unavailable}
                            onClick={() => chooseBasemap(choice)}
                        />;
                    }) : <div className="orbit-action-menu__loading">Cargando mapas base…</div>}
                </div>}
            </>}
        </ActionMenuSurface>

        {isOrbit && submenu === "View" && <ActionMenuSurface
            id="catalogContextViewMenu"
            className="open orbit-orbit-context-menu orbit-orbit-context-menu--submenu"
            title="Vista"
            icon={<OrbitalSatelliteIcon />}
            left={viewPosition.left}
            top={viewPosition.top}
            ariaLabel={`Opciones de vista de ${name}`}
        >
            <ActionMenuItem title="Centrar vista" description="Mueve la cámara al objeto seleccionado." trailing={false} onClick={(event) => select("center-view", event)} />
            <ActionMenuItem title={visibilityTitle} description={visibilityDescription} trailing={false} onClick={(event) => select("toggle-visibility", event)} />
            <ActionMenuItem title={groundTrackTitle} description={groundTrackDescription} trailing={false} onClick={(event) => select("ground", event)} />
            <ActionMenuItem title="Opciones de visualización" description="Ajusta trayectoria, etiquetas y proyecciones." trailing={false} onClick={(event) => select("viz", event)} />
        </ActionMenuSurface>}

        {isOrbit && submenu === "Ephemerides" && <ActionMenuSurface
            id="catalogContextEphemeridesMenu"
            className="open orbit-orbit-context-menu orbit-orbit-context-menu--submenu"
            title="Efemérides"
            icon={<OrbitalSatelliteIcon />}
            left={ephemeridesPosition.left}
            top={ephemeridesPosition.top}
            ariaLabel={`Efemérides de ${name}`}
        >
            <ActionMenuItem title="Propagación" description="Consulta el estado propagado y sus elementos a lo largo de la simulación." trailing={false} onClick={(event) => select("propagated-parameters", event)} />
            <ActionMenuItem title="Explicar parámetros orbitales" description="Describe los elementos, el marco y la procedencia de la órbita." trailing={false} onClick={(event) => select("explain", event)} />
            {menu.manualOrbit === true && <>
                <ActionMenuSeparator />
                <ActionMenuItem title="Editar órbita manual" description="Vuelve al diseño de esta órbita local." trailing={false} onClick={(event) => select("edit-manual", event)} />
            </>}
        </ActionMenuSurface>}
    </>;
}
