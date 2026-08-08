import { useEffect, useMemo, useState } from "react";

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
    const width = 294;
    const margin = 10;
    const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const left = clamp(Number(anchor?.left) || Math.round((viewportWidth - width) / 2), margin, Math.max(margin, viewportWidth - width - margin));
    const top = clamp(Number(anchor?.top) || 88, margin, Math.max(margin, viewportHeight - 224));
    return { left, top };
}

/**
 * Opens a common format picker from panels, layer context menus and project
 * actions. `stationId` is null when the requested export includes every
 * ground station in the workspace.
 */
export function openGroundStationExportMenu({ stationId = null, source = "unknown", anchor = null } = {}) {
    window.dispatchEvent(new CustomEvent(GROUND_STATION_EXPORT_MENU_OPEN_EVENT, {
        detail: {
            stationId: typeof stationId === "string" && stationId.trim() ? stationId.trim() : null,
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

    return <section
        data-ground-station-export-menu="true"
        className="fixed z-[10310] w-[294px] rounded-[10px] border border-[#35557e] bg-[linear-gradient(145deg,rgba(13,26,45,.98),rgba(7,15,28,.98))] p-[6px] font-[system-ui,sans-serif] text-[#e5efff] shadow-[0_16px_36px_rgba(0,0,0,.5)] backdrop-blur-md"
        style={{ left: `${position.left}px`, top: `${position.top}px` }}
        role="dialog"
        aria-label={`Exportar ${exportTarget}`}
        onPointerDown={(event) => event.stopPropagation()}
    >
        <div className="flex items-center justify-between gap-3 border-b border-[#233b5b] px-[7px] pt-[3px] pb-[7px]">
            <div>
                <strong className="block text-[11px] leading-none">Exportar {exportTarget}</strong>
                <span className="mt-1 block text-[9px] leading-snug text-[#8fa7c8]">Elige el formato de intercambio.</span>
            </div>
            <button type="button" className="grid size-6 cursor-pointer place-items-center rounded-[5px] border border-[#2c486c] bg-transparent p-0 text-[15px] leading-none text-[#a9c0df] hover:border-[#5e80b5] hover:bg-[#162a47] hover:text-white" title="Cerrar" aria-label="Cerrar formatos de exportación" onClick={() => setMenu(null)}>×</button>
        </div>
        <div className="mt-1 grid gap-[3px]" role="menu" aria-label="Formato de exportación">
            {FORMATS.map((format) => <button
                className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[6px] border-0 bg-transparent px-[8px] py-[7px] text-left transition-colors hover:bg-[#173157] focus-visible:bg-[#173157] focus-visible:outline-none"
                type="button"
                role="menuitem"
                key={format.id}
                onClick={() => chooseFormat(format.id)}
            >
                <span className="grid min-w-0 gap-[3px]">
                    <span className="text-[11px] leading-none font-semibold text-[#e0eafe]">{format.label}</span>
                    <span className="text-[9px] leading-snug font-medium text-[#8fa7c8]">{format.description}</span>
                </span>
                <span className="rounded border border-[#284566] bg-[#0b192c] px-1.5 py-0.5 font-mono text-[8px] font-semibold text-[#a9c7ed]">{format.extension}</span>
            </button>)}
        </div>
    </section>;
}
