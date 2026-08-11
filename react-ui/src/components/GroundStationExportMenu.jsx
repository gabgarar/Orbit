import { useEffect, useMemo, useState } from "react";
import PanelCloseButton from "./PanelCloseButton.jsx";
import { GroundStationIcon } from "./icons.jsx";

/**
 * The React surface owns format selection only.  `front/main.js` owns the
 * download because it is the authority for the authored station layers.
 */
const GROUND_STATION_EXPORT_REQUEST_EVENT = "orbit:ground-stations-export-request";
const GROUND_STATION_EXPORT_MENU_OPEN_EVENT = "orbit:ground-stations-export-menu-open";

const FORMATS = Object.freeze([
    {
        id: "geojson",
        label: "GeoJSON",
        extension: ".geojson",
        title: "Intercambio GIS recomendado",
        description: "Exporta puntos WGS-84 con la ubicación y las propiedades RF/visuales autoradas de la estación.",
        note: "Es la opción recomendada para QGIS, aplicaciones web y flujos GIS que trabajen con estaciones terrestres."
    },
    {
        id: "kml",
        label: "KML",
        extension: ".kml",
        title: "Visualización geoespacial",
        description: "Genera puntos con altitud para abrir las estaciones en Google Earth y otros visores KML.",
        note: "KML conserva la posición y metadatos legibles; para reimportar todo el contrato RF use Orbit JSON o GeoJSON."
    },
    {
        id: "kmz",
        label: "KMZ",
        extension: ".kmz",
        title: "KML comprimido",
        description: "Empaqueta el mismo contenido KML en un archivo comprimido, cómodo para compartir con Google Earth.",
        note: "No contiene trayectorias ni efemérides: una estación es un punto geográfico estático."
    },
    {
        id: "gpkg",
        label: "GeoPackage (GPKG)",
        extension: ".gpkg",
        title: "GIS profesional",
        description: "Entrega una capa de puntos WGS-84 con atributos autorados de cada estación en una base de datos GeoPackage.",
        note: "Es la opción robusta para QGIS, ArcGIS y análisis GIS. No representa una estación como una órbita ni inventa datos orbitales."
    },
    {
        id: "wkt",
        label: "WKT",
        extension: ".wkt",
        title: "Geometría para bases espaciales",
        description: "Exporta la geometría POINT Z o MULTIPOINT Z en texto Well-Known Text.",
        note: "Útil para SQL/PostGIS. WKT transporta la geometría, no el contrato RF completo ni preferencias visuales."
    },
    {
        id: "wkb",
        label: "WKB",
        extension: ".wkb",
        title: "Geometría binaria",
        description: "Exporta la misma geometría POINT Z o MULTIPOINT Z en Well-Known Binary.",
        note: "Pensado para bases de datos y APIs espaciales. Los atributos de estación no se codifican dentro de WKB."
    },
    {
        id: "orbit-json",
        label: "Orbit JSON",
        extension: ".json",
        title: "Copia nativa y sin pérdida",
        description: "Guarda el contrato autorado de la estación, incluidos RF, máscara, límites mecánicos y visualización.",
        note: "Use este formato para volver a importar estaciones en Orbit sin perder configuración."
    },
    {
        id: "csv",
        label: "CSV",
        extension: ".csv",
        title: "Tabla editable",
        description: "Exporta campos escalares de estación en una tabla compatible con hojas de cálculo y catálogos.",
        note: "CSV no lleva una geometría GIS formal; conserva latitud, longitud, altura y parámetros escalares autorados."
    }
]);

/**
 * Opens the common station export dialogue from panels, layer context menus
 * and project actions. `stationId` is null when the request includes every
 * ground-station layer in the workspace. `anchor` stays accepted for callers
 * from the former compact menu; the modal intentionally does not use it.
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

function formatById(id) {
    return FORMATS.find((format) => format.id === id) || FORMATS[0];
}

export default function GroundStationExportMenu() {
    const [dialog, setDialog] = useState(null);
    const [formatId, setFormatId] = useState(FORMATS[0].id);

    useEffect(() => {
        const open = (event) => {
            setDialog(event.detail || {});
            setFormatId(FORMATS[0].id);
        };
        window.addEventListener(GROUND_STATION_EXPORT_MENU_OPEN_EVENT, open);
        return () => window.removeEventListener(GROUND_STATION_EXPORT_MENU_OPEN_EVENT, open);
    }, []);

    useEffect(() => {
        if (!dialog) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === "Escape") setDialog(null);
        };
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [dialog]);

    const selectedFormat = useMemo(() => formatById(formatId), [formatId]);
    if (!dialog) return null;

    const oneStation = Boolean(dialog.stationId);
    const target = oneStation ? (dialog.stationName || "Estación terrestre") : "Estaciones terrestres";
    const targetDescription = oneStation
        ? "Se exportará una única estación terrestre."
        : "Se exportarán todas las estaciones terrestres del proyecto actual.";
    const chooseFormat = () => {
        window.dispatchEvent(new CustomEvent(GROUND_STATION_EXPORT_REQUEST_EVENT, {
            detail: {
                stationId: dialog.stationId || null,
                format: selectedFormat.id,
                source: dialog.source || "unknown"
            }
        }));
        setDialog(null);
    };

    return <div
        id="groundStationExportMenu"
        data-ground-station-export-menu="true"
        data-ground-station-export-dialog="true"
        className="fixed inset-0 z-[10340] flex items-center justify-center bg-[rgba(1,6,14,.62)] p-4"
        role="presentation"
        onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}
    >
        <section
            className="grid w-[min(calc(580px*var(--orbit-ui-scale,1)),96vw)] max-h-[min(720px,calc(100vh-32px))] gap-3 overflow-auto rounded-[var(--orbit-radius-window)] border border-[var(--orbit-frame-color)] bg-[var(--orbit-surface-window)] p-4 text-[var(--orbit-text-primary)] shadow-[0_24px_60px_rgba(0,0,0,.50)] [font-family:var(--orbit-font-ui)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="groundStationExportDialogTitle"
        >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--orbit-frame-color)] pb-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[var(--orbit-radius-control)] border border-[#315477] bg-[rgba(31,63,104,.25)] text-[#9cc5ff]" aria-hidden="true"><GroundStationIcon /></span>
                    <div className="min-w-0">
                        <h3 id="groundStationExportDialogTitle" className="m-0 truncate text-[var(--orbit-font-size-panel-title)] font-semibold tracking-[.01em]">Exportar {target}</h3>
                        <p className="mt-1 mb-0 text-[var(--orbit-font-size-meta)] leading-snug text-[var(--orbit-text-secondary)]">{targetDescription}</p>
                    </div>
                </div>
                <PanelCloseButton onClick={() => setDialog(null)} label="Cerrar exportación de estaciones" />
            </header>

            <label className="grid gap-1.5 text-[var(--orbit-font-size-body)] font-semibold text-[var(--orbit-text-secondary)]">
                Formato
                <select
                    value={formatId}
                    onChange={(event) => setFormatId(event.target.value)}
                    className="min-h-10 rounded-[var(--orbit-radius-control)] border border-[var(--orbit-frame-color)] bg-[var(--orbit-bg-input)] px-2.5 text-[var(--orbit-font-size-body)] font-medium text-[var(--orbit-text-primary)] outline-none focus:border-[#648eff]"
                >
                    {FORMATS.map((format) => <option key={format.id} value={format.id}>{format.label} ({format.extension})</option>)}
                </select>
            </label>

            <section className="grid gap-1.5 rounded-[var(--orbit-radius-control)] border border-[#a87820] bg-[rgba(115,73,13,.18)] px-3 py-2.5 text-[#f5ddb0]" aria-live="polite">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <strong className="text-[11px]">{selectedFormat.title}</strong>
                    <span className="rounded border border-[#bd8525] bg-[rgba(147,94,17,.18)] px-1.5 py-0.5 text-[9px] font-semibold tracking-[.05em]">{selectedFormat.extension}</span>
                </div>
                <p className="m-0 text-[11px] leading-relaxed text-[#f1d9a5]">{selectedFormat.description}</p>
                <p className="m-0 text-[10px] leading-relaxed text-[#d7bd88]">{selectedFormat.note}</p>
                <p className="m-0 border-t border-[rgba(198,147,55,.35)] pt-2 text-[9px] leading-relaxed text-[#cdae77]">Las estaciones son puntos terrestres estáticos: esta exportación no genera TLE, OEM, efemérides ni otros datos orbitales.</p>
            </section>

            <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--orbit-frame-color)] pt-3">
                <button type="button" className="cursor-pointer rounded-[var(--orbit-radius-control)] border border-[var(--orbit-frame-color)] bg-transparent px-3 py-2 text-[11px] font-semibold text-[var(--orbit-text-secondary)] transition-colors hover:border-[#5d82b7] hover:text-[var(--orbit-text-primary)]" onClick={() => setDialog(null)}>Cancelar</button>
                <button type="button" className="cursor-pointer rounded-[var(--orbit-radius-control)] border border-[#6b8cff] bg-[#304dbd] px-3 py-2 text-[11px] font-semibold text-white shadow-[0_0_18px_rgba(66,97,215,.18)] transition-colors hover:bg-[#3b5bd1]" onClick={chooseFormat}>Exportar {selectedFormat.label}</button>
            </footer>
        </section>
    </div>;
}
