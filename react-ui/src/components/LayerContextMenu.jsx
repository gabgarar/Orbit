import { useEffect, useState } from "react";
import { openGroundStationExportMenu } from "./GroundStationExportMenu.jsx";
import { ActionMenuItem, ActionMenuSeparator, ActionMenuSurface } from "./ActionMenuSurface.jsx";
import { EarthIcon, GroundStationIcon, OrbitalSatelliteIcon } from "./icons.jsx";

function displayLayerName(menu) {
    return String(menu?.name || menu?.title || menu?.id || "Capa").trim() || "Capa";
}

function actionDetails({ isEarth, isCelestialBody, groundStation, manualOrbit, visible, groundTrackVisible }) {
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

    return [
        { action: "center-view", label: "Centrar vista", description: "Mueve la cámara al objeto." },
        visibility,
        { action: "rename", label: "Renombrar capa", description: "Cambia el nombre visible en el proyecto." },
        ...(manualOrbit ? [{ action: "edit-manual", label: "Editar órbita manual", description: "Vuelve al diseño de esta órbita." }] : []),
        { action: "propagated-parameters", label: "Efemérides", description: "Consulta el estado propagado y sus elementos." },
        { action: "explain", label: "Explicar parámetros", description: "Describe los valores orbitales actuales." },
        { action: "viz", label: "Opciones de visualización", description: "Ajusta trayectoria, etiquetas y proyecciones." },
        {
            action: "ground",
            label: groundTrackVisible ? "Ocultar Ground Track" : "Mostrar Ground Track",
            description: groundTrackVisible ? "Oculta la proyección terrestre." : "Muestra la proyección terrestre."
        },
        { action: "export", label: "Exportar…", description: "Guarda los datos disponibles de la capa.", separator: true },
        { action: "remove", label: "Eliminar capa", description: "La quita de este proyecto.", danger: true }
    ];
}

export default function LayerContextMenu() {
    const [menu, setMenu] = useState(null);
    const [basemapChoices, setBasemapChoices] = useState(null);
    const [basemapPickerOpen, setBasemapPickerOpen] = useState(false);

    useEffect(() => {
        const open = (event) => setMenu(event.detail || null);
        const close = () => setMenu(null);
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
    }, [menu?.id]);

    useEffect(() => {
        if (!menu) return undefined;
        const close = () => setMenu(null);
        const onKey = (event) => event.key === "Escape" && close();
        document.addEventListener("pointerdown", close, { once: true });
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [menu]);

    if (!menu) return null;

    const layerType = String(menu.layerType || "").toUpperCase();
    const isEarth = menu.earth === true || layerType === "EARTH" || String(menu.id || "").toLowerCase() === "body:earth";
    const isCelestialBody = layerType === "CELESTIAL_BODY" || isEarth;
    const isGroundStation = menu.groundStation === true || layerType === "GROUND_STATION";
    const name = displayLayerName(menu);
    const icon = isGroundStation
        ? <GroundStationIcon />
        : (isCelestialBody ? <EarthIcon /> : <OrbitalSatelliteIcon />);
    const actions = actionDetails({
        isEarth,
        isCelestialBody,
        groundStation: isGroundStation,
        manualOrbit: menu.manualOrbit === true,
        visible: menu.visible,
        groundTrackVisible: menu.groundTrackVisible === true
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
            setMenu(null);
            return;
        }
        window.dispatchEvent(new CustomEvent("orbit:layer-context-action", {
            detail: { action, id: menu.id, source: "layer" }
        }));
        setMenu(null);
    };

    const chooseBasemap = (choice) => {
        const basemapId = String(choice?.id || "").trim();
        if (!basemapId || choice?.available === false) return;
        window.dispatchEvent(new CustomEvent("orbit:earth-basemap-request", {
            detail: { id: menu.id, basemapId, source: "layer-context" }
        }));
        setBasemapPickerOpen(false);
    };

    return <ActionMenuSurface
        id="catalogContextMenu"
        className="open"
        title={name}
        icon={icon}
        left={menu.left}
        top={menu.top}
        ariaLabel={`Opciones de ${name}`}
    >
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
    </ActionMenuSurface>;
}
