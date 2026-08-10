import { useEffect, useState } from "react";
import { openGroundStationExportMenu } from "./GroundStationExportMenu.jsx";
import { ActionMenuItem, ActionMenuSurface } from "./ActionMenuSurface.jsx";
import { EarthIcon, GroundStationIcon, OrbitalSatelliteIcon } from "./icons.jsx";

function displayLayerName(menu) {
    return String(menu?.name || menu?.title || menu?.id || "Objeto").trim() || "Objeto";
}

export default function SatelliteContextMenu() {
    const [menu, setMenu] = useState(null);

    useEffect(() => {
        const open = (event) => setMenu(event.detail || null);
        const close = () => setMenu(null);
        window.addEventListener("orbit:satellite-context-open", open);
        window.addEventListener("orbit:satellite-context-close", close);
        return () => {
            window.removeEventListener("orbit:satellite-context-open", open);
            window.removeEventListener("orbit:satellite-context-close", close);
        };
    }, []);

    useEffect(() => {
        if (!menu) return undefined;
        const close = () => setMenu(null);
        const closeOnEscape = (event) => {
            if (event.key === "Escape") close();
        };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [menu]);

    if (!menu) return null;

    const name = displayLayerName(menu);
    const layerType = String(menu.layerType || "").toUpperCase();
    const isCelestialBody = ["CELESTIAL_BODY", "EARTH"].includes(layerType)
        || String(menu.id || "").toLowerCase() === "body:earth";
    const isGroundStation = layerType === "GROUND_STATION";
    const icon = isGroundStation
        ? <GroundStationIcon />
        : (isCelestialBody ? <EarthIcon /> : <OrbitalSatelliteIcon />);

    const selectAction = (type) => {
        window.dispatchEvent(new CustomEvent("orbit:satellite-context-action", {
            detail: { type, id: menu.id, sourceId: menu.sourceId || menu.id }
        }));
        setMenu(null);
    };

    return <ActionMenuSurface
        id="satelliteContextMenu"
        className="open"
        title={name}
        icon={icon}
        left={menu.left}
        top={menu.top}
        ariaLabel={`Opciones de ${name}`}
    >
        <ActionMenuItem
            title="Centrar vista"
            description="Mueve la cámara al objeto seleccionado."
            onClick={() => selectAction("center-view")}
        />
        {isGroundStation && <ActionMenuItem
            title="Actualizar parámetros"
            description="Edita ubicación, máscara y configuración RF."
            onClick={() => selectAction("station")}
        />}
        {isGroundStation && <ActionMenuItem
            title="Exportar…"
            description="Elige GeoJSON, KML/KMZ, GeoPackage, WKT/WKB, Orbit JSON o CSV."
            data-ground-station-export-control="true"
            onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                openGroundStationExportMenu({
                    stationId: menu.id,
                    stationName: name,
                    source: "satellite-context",
                    anchor: { left: rect.left, top: rect.bottom + 6 }
                });
                setMenu(null);
            }}
        />}
        {!isCelestialBody && !isGroundStation && <ActionMenuItem
            title="Opciones de visualización"
            description="Ajusta trayectoria, etiquetas y proyecciones."
            onClick={() => selectAction("visualization")}
        />}
        {!isCelestialBody && !isGroundStation && <ActionMenuItem
            title="Efemérides"
            description="Consulta el estado propagado y sus elementos."
            onClick={() => selectAction("propagated-parameters")}
        />}
        {!isCelestialBody && !isGroundStation && menu.canEditManualOrbit === true && <ActionMenuItem
            title="Editar órbita manual"
            description="Vuelve al diseño de esta órbita."
            onClick={() => selectAction("edit-manual")}
        />}
    </ActionMenuSurface>;
}
