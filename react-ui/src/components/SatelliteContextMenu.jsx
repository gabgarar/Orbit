import { useEffect, useState } from "react";
import { openGroundStationExportMenu } from "./GroundStationExportMenu.jsx";
import { ActionMenuItem, ActionMenuSeparator, ActionMenuSurface } from "./ActionMenuSurface.jsx";
import { EarthIcon, GroundStationIcon, OrbitalSatelliteIcon } from "./icons.jsx";
import { getOrbitContextSubmenuPosition } from "./orbitContextMenuLayout.js";

function displayLayerName(menu) {
    return String(menu?.name || menu?.title || menu?.id || "Objeto").trim() || "Objeto";
}

/**
 * Contextual menu used from the globe. The runtime remains the action owner;
 * this surface only exposes an orderly, keyboard-accessible hierarchy.
 */
export default function SatelliteContextMenu() {
    const [menu, setMenu] = useState(null);
    const [submenu, setSubmenu] = useState(null);

    const close = () => {
        setMenu(null);
        setSubmenu(null);
    };

    useEffect(() => {
        const open = (event) => {
            setMenu(event.detail || null);
            setSubmenu(null);
        };
        window.addEventListener("orbit:satellite-context-open", open);
        window.addEventListener("orbit:satellite-context-close", close);
        return () => {
            window.removeEventListener("orbit:satellite-context-open", open);
            window.removeEventListener("orbit:satellite-context-close", close);
        };
    }, []);

    useEffect(() => {
        if (!menu) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === "Escape") close();
        };
        const focusSubmenu = window.requestAnimationFrame(() => {
            if (!submenu) return;
            document.querySelector(`#satelliteContext${submenu}Menu [data-context-menu-action='true']`)
                ?.focus({ preventScroll: true });
        });
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            window.cancelAnimationFrame(focusSubmenu);
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [menu, submenu]);

    if (!menu) return null;

    const name = displayLayerName(menu);
    const layerType = String(menu.layerType || "").toUpperCase();
    const isCelestialBody = ["CELESTIAL_BODY", "EARTH"].includes(layerType)
        || String(menu.id || "").toLowerCase() === "body:earth";
    const isEarth = layerType === "EARTH" || String(menu.id || "").toLowerCase() === "body:earth";
    const isGroundStation = layerType === "GROUND_STATION";
    const isOrbit = !isCelestialBody && !isGroundStation;
    const icon = isGroundStation
        ? <GroundStationIcon />
        : (isCelestialBody ? <EarthIcon /> : <OrbitalSatelliteIcon />);

    const selectAction = (type) => {
        // The tree and the globe must execute the exact same layer operation.
        // `objectSidebar` remains the action owner for exports, explanations,
        // ground tracks and removal, so the globe does not grow a second set
        // of subtly different handlers.
        const action = type === "visualization" ? "viz" : type;
        window.dispatchEvent(new CustomEvent("orbit:layer-context-action", {
            detail: { action, id: menu.id, source: "globe" }
        }));
        close();
    };
    const showSubmenu = (nextSubmenu) => setSubmenu(nextSubmenu);
    const viewPosition = getOrbitContextSubmenuPosition(menu, { level: 1, height: isOrbit ? 236 : 150 });
    const ephemeridesPosition = getOrbitContextSubmenuPosition(menu, {
        level: 2,
        height: menu.canEditManualOrbit === true ? 190 : 146
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
            id="satelliteContextMenu"
            className="open orbit-orbit-context-menu"
            title={name}
            icon={icon}
            left={menu.left}
            top={menu.top}
            ariaLabel={`Opciones de ${name}`}
        >
            <ActionMenuItem
                title="Vista"
                description="Cámara, visibilidad y representación de la capa."
                aria-haspopup="menu"
                aria-expanded={submenu === "View"}
                onClick={() => showSubmenu("View")}
            />
            {isOrbit && <ActionMenuItem
                title="Efemérides"
                description="Propagación y explicación de los parámetros orbitales."
                aria-haspopup="menu"
                aria-expanded={submenu === "Ephemerides"}
                onClick={() => showSubmenu("Ephemerides")}
            />}
            {isGroundStation && <ActionMenuItem
                title="Actualizar parámetros"
                description="Edita ubicación, máscara y configuración RF."
                trailing={false}
                onClick={() => selectAction("station")}
            />}
            {isOrbit && <ActionMenuItem
                title="Exportar…"
                description="Guarda los datos disponibles de la capa."
                trailing={false}
                onClick={() => selectAction("export")}
            />}
            {isGroundStation && <ActionMenuItem
                title="Exportar…"
                description="Elige GeoJSON, KML/KMZ, GeoPackage, WKT/WKB, Orbit JSON o CSV."
                data-ground-station-export-control="true"
                trailing={false}
                onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    openGroundStationExportMenu({
                        stationId: menu.id,
                        stationName: name,
                        source: "satellite-context",
                        anchor: { left: rect.left, top: rect.bottom + 6 }
                    });
                    close();
                }}
            />}
            {!isEarth && <>
                <ActionMenuSeparator />
                <ActionMenuItem
                    title="Eliminar capa"
                    description="La quita de este proyecto."
                    danger
                    trailing={false}
                    onClick={() => selectAction("remove")}
                />
            </>}
        </ActionMenuSurface>

        {submenu === "View" && <ActionMenuSurface
            id="satelliteContextViewMenu"
            className="open orbit-orbit-context-menu orbit-orbit-context-menu--submenu"
            title="Vista"
            icon={icon}
            left={viewPosition.left}
            top={viewPosition.top}
            ariaLabel={`Opciones de vista de ${name}`}
        >
            <ActionMenuItem title="Centrar vista" description="Mueve la cámara al objeto seleccionado." trailing={false} onClick={() => selectAction("center-view")} />
            <ActionMenuItem title={visibilityTitle} description={visibilityDescription} trailing={false} onClick={() => selectAction("toggle-visibility")} />
            {isOrbit && <>
                <ActionMenuItem title={groundTrackTitle} description={groundTrackDescription} trailing={false} onClick={() => selectAction("ground")} />
                <ActionMenuItem title="Opciones de visualización" description="Ajusta trayectoria, etiquetas y proyecciones." trailing={false} onClick={() => selectAction("visualization")} />
            </>}
        </ActionMenuSurface>}

        {submenu === "Ephemerides" && isOrbit && <ActionMenuSurface
            id="satelliteContextEphemeridesMenu"
            className="open orbit-orbit-context-menu orbit-orbit-context-menu--submenu"
            title="Efemérides"
            icon={<OrbitalSatelliteIcon />}
            left={ephemeridesPosition.left}
            top={ephemeridesPosition.top}
            ariaLabel={`Efemérides de ${name}`}
        >
            <ActionMenuItem title="Propagación" description="Consulta el estado propagado y sus elementos a lo largo de la simulación." trailing={false} onClick={() => selectAction("propagated-parameters")} />
            <ActionMenuItem title="Explicar parámetros orbitales" description="Describe los elementos, el marco y la procedencia de la órbita." trailing={false} onClick={() => selectAction("explain")} />
            {menu.canEditManualOrbit === true && <>
                <ActionMenuSeparator />
                <ActionMenuItem title="Editar órbita manual" description="Vuelve al diseño de esta órbita local." trailing={false} onClick={() => selectAction("edit-manual")} />
            </>}
        </ActionMenuSurface>}
    </>;
}
