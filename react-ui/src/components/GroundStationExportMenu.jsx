import { useEffect, useMemo, useState } from "react";
import { ActionMenuItem, ActionMenuSurface } from "./ActionMenuSurface.jsx";
import { GroundStationIcon } from "./icons.jsx";

/**
 * The UI emits this request after the operator chooses an interchange format.
 * The Cesium/runtime side owns the actual serialization and download.
 */
export const GROUND_STATION_EXPORT_REQUEST_EVENT = "orbit:ground-stations-export-request";
export const GROUND_STATION_EXPORT_MENU_OPEN_EVENT = "orbit:ground-stations-export-menu-open";

const FORMATS = [
    {
        id: "geojson",
        label: "GeoJSON",
        description: "Interoperable; conserva ubicación y parámetros RF de Orbit.",
        extension: ".geojson"
    },
    {
        id: "orbit-json",
        label: "Orbit JSON",
        description: "Copia nativa para restaurar estaciones sin pérdida.",
        extension: ".json"
    },
    {
        id: "csv",
        label: "CSV",
        description: "Tabla editable para hojas de cálculo y catálogos.",
        extension: ".csv"
    }
];

function clamp(value, lower, upper) {
    return Math.min(Math.max(value, lower), upper);
}

function menuPosition(anchor) {
    const width = 286;
    const margin = 10;
    const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const left = clamp(Number(anchor?.left) || Math.round((viewportWidth - width) / 2), margin, Math.max(margin, viewportWidth - width - margin));
    const top = clamp(Number(anchor?.top) || 88, margin, Math.max(margin, viewportHeight - 190));
    return { left, top };
}

/**
 * Opens a common format picker from panels, layer context menus and project
 * actions. `stationId` is null when the requested export includes every
 * ground station in the workspace.
 */
export function openGroundStationExportMenu({ stationId = null, stationName = "", source = "unknown", anchor = null } = {}) {
    window.dispatchEvent(new CustomEvent(GROUND_STATION_EXPORT_MENU_OPEN_EVENT, {
        detail: {
            stationId: typeof stationId === "string" && stationId.trim() ? stationId.trim() : null,
            stationName: typeof stationName === "string" ? stationName.trim() : "",
            source,
            anchor
        }
    }));
}

export default function GroundStationExportMenu() {
    const [menu, setMenu] = useState(null);

    useEffect(() => {
        const open = (event) => setMenu(event.detail || {});
        window.addEventListener(GROUND_STATION_EXPORT_MENU_OPEN_EVENT, open);
        return () => window.removeEventListener(GROUND_STATION_EXPORT_MENU_OPEN_EVENT, open);
    }, []);

    useEffect(() => {
        if (!menu) return undefined;
        const closeOnPointer = (event) => {
            if (event.target?.closest?.("[data-ground-station-export-menu='true'], [data-ground-station-export-control='true']")) return;
            setMenu(null);
        };
        const closeOnEscape = (event) => {
            if (event.key === "Escape") setMenu(null);
        };
        document.addEventListener("pointerdown", closeOnPointer);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOnPointer);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [menu]);

    const position = useMemo(() => menuPosition(menu?.anchor), [menu]);
    if (!menu) return null;

    const exportTarget = menu.stationId ? "esta estación" : "las estaciones";
    const title = menu.stationId ? (menu.stationName || "Estación terrestre") : "Estaciones terrestres";
    const chooseFormat = (format) => {
        window.dispatchEvent(new CustomEvent(GROUND_STATION_EXPORT_REQUEST_EVENT, {
            detail: {
                stationId: menu.stationId || null,
                format,
                source: menu.source || "unknown"
            }
        }));
        setMenu(null);
    };

    return <ActionMenuSurface
        id="groundStationExportMenu"
        data-ground-station-export-menu="true"
        title={title}
        icon={<GroundStationIcon />}
        left={position.left}
        top={position.top}
        ariaLabel={`Exportar ${exportTarget}`}
    >
        {FORMATS.map((format) => <ActionMenuItem
            title={format.label}
            description={format.description}
            trailing={<span className="orbit-action-menu__extension" aria-label={format.extension}>{format.extension}</span>}
            key={format.id}
            onClick={() => chooseFormat(format.id)}
        />)}
    </ActionMenuSurface>;
}
