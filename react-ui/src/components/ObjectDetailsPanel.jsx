import { useEffect, useRef, useState } from "react";
import { buildObjectDetails } from "../features/objectDetails/detailRows.js";
import useSelectedObject from "../hooks/useSelectedObject.js";
import { emitPropagatedParametersOpen } from "../../../front/js/runtime/propagatedParametersEvents.js";

const standardTabs = [
    ["overview", "OVERVIEW", "Overview"],
    ["orbit", "ORBIT", "Orbit"],
    ["telemetry", "TELEMETRY", "Telemetry"],
    ["input", "INPUT", "Ephemeris / Input"],
    ["propagation", "PROP.", "Propagation"]
];
const groundStationTabs = [
    ["overview", "OVERVIEW", "Station identity"],
    ["access", "PASSES", "Access and visibility"],
    ["monitoring", "MONITOR", "Monitored satellites"],
    ["configuration", "CONFIG", "Station configuration"]
];
const toneClass = { "is-operational": "text-[#73e3a0]", "is-hidden": "text-[#d2a8ff]" };

function number(input, digits = 1) {
    return Number.isFinite(Number(input)) ? Number(input).toFixed(digits) : "-";
}

function utc(input) {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? "-" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function stationRows(detail) {
    const telemetry = detail.telemetry || {};
    const station = telemetry.station || detail.station || {};
    const realtime = telemetry.realtime || {};
    const monitored = Array.isArray(station.monitor_satellite_ids) ? station.monitor_satellite_ids : [];
    const nextPass = Array.isArray(telemetry.next_passes) ? telemetry.next_passes[0] : null;
    return {
        overview: [
            ["Nombre", station.name || detail.name || detail.id || "-"],
            ["Tipo", "Estación terrestre"],
            ["Coordenadas", `${number(station.latitude_deg, 5)}°, ${number(station.longitude_deg, 5)}°`],
            ["Altitud", `${number(station.altitude_m, 1)} m`],
            ["Marco terrestre", "ITRF / WGS-84"],
            ["Estado", detail.active === false ? "Oculta" : "Activa", detail.active === false ? "is-hidden" : "is-operational"]
        ],
        access: [
            ["Satélites visibles", `${number(realtime.visible_satellites, 0)} / ${number(realtime.active_satellites, 0)}`],
            ["Mejor elevación", `${number(realtime.best_elevation_deg, 1)}°`],
            ["Mejor alcance", `${number(realtime.best_range_km, 1)} km`],
            ["Mejor enlace", `${number(realtime.best_link_dbm, 1)} dBm`],
            ["Próximo AOS", nextPass?.aos ? utc(nextPass.aos) : "Sin pases calculados"],
            ["Próximo LOS", nextPass?.los ? utc(nextPass.los) : "-"]
        ],
        monitoring: [
            ["Capas monitorizadas", `${monitored.length}`],
            ["Cobertura de pases", "24 h al calcular AOS / LOS"],
            ["Método", "Elevación ITRF respecto a máscara"]
        ],
        configuration: [
            ["Máscara de elevación", `${number(station.min_elevation_deg, 1)}°`],
            ["Frecuencia", `${number(station.frequency_mhz, 3)} MHz`],
            ["Potencia TX", `${number(station.tx_power_dbm, 1)} dBm`],
            ["Ganancia TX", `${number(station.tx_gain_dbi, 1)} dBi`],
            ["Ganancia RX", `${number(station.rx_gain_dbi, 1)} dBi`]
        ]
    };
}

function DetailRows({ rows }) {
    return <div className="grid gap-[11px] py-[2px] pb-[14px]">
        {rows.map(([label, data, tone]) => <div className="grid grid-cols-[minmax(92px,1fr)_minmax(80px,1.25fr)] items-start gap-2.5 text-[11px] leading-[1.35] font-medium text-[#91a1b8]" key={label}>
            <span>{label}</span>
            <strong className={`wrap-anywhere text-right font-semibold text-[#e0e9f8] ${toneClass[tone] || ""}`}>{data}</strong>
        </div>)}
    </div>;
}

function dispatchObjectAction(type, id) {
    if (!id) return;
    window.dispatchEvent(new CustomEvent("orbit:selected-object-action", { detail: { type, id } }));
}

function openPropagatedParameters(id) {
    if (!id) return;
    emitPropagatedParametersOpen({ id, source: "details" });
}

function TuneGlyph() {
    return <svg className="size-3.5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /></svg>;
}

function TleGlyph() {
    return <svg className="size-3.5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
}

function PropagationGlyph() {
    return <svg className="size-3.5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5V4.5M4 19.5h16" /><path d="m6.5 15.5 4-4 3 2.25 4-6.25" /><circle cx="6.5" cy="15.5" r="1" /><circle cx="10.5" cy="11.5" r="1" /><circle cx="13.5" cy="13.75" r="1" /><circle cx="17.5" cy="7.5" r="1" /></svg>;
}

export default function ObjectDetailsPanel() {
    const selectedDetail = useSelectedObject();
    const [detail, setDetail] = useState(null);
    const [tab, setTab] = useState("overview");
    const [dismissedId, setDismissedId] = useState(null);
    const [designMode, setDesignMode] = useState(false);
    const lastSelection = useRef({ id: null, revision: null });

    // The runtime clears its transient selection when the user clicks the globe
    // or another UI surface. The information card remains open until the user
    // explicitly closes it, while still receiving live telemetry updates.
    useEffect(() => {
        if (!selectedDetail?.id) {
            return;
        }

        const revision = Number.isFinite(Number(selectedDetail.selectionRevision))
            ? Number(selectedDetail.selectionRevision)
            : null;
        const selectionChanged = revision === null
            ? lastSelection.current.id !== selectedDetail.id
            : lastSelection.current.revision !== revision;
        lastSelection.current = { id: selectedDetail.id, revision };
        setDetail(selectedDetail);

        if (selectionChanged) {
            setTab("overview");
            setDismissedId(null);
        }
    }, [selectedDetail]);

    useEffect(() => {
        const onDesignMode = (event) => setDesignMode(event.detail?.active === true);
        window.addEventListener("orbit:manual-orbit-design-state", onDesignMode);
        return () => window.removeEventListener("orbit:manual-orbit-design-state", onDesignMode);
    }, []);

    if (designMode || !detail || dismissedId === detail.id) return null;

    const details = buildObjectDetails(detail);
    const isGroundStation = String(detail.layerType || "").toUpperCase() === "GROUND_STATION";
    const isCelestialBody = ["CELESTIAL_BODY", "EARTH"].includes(String(detail.layerType || "").toUpperCase())
        || String(detail.id || "").toLowerCase() === "body:earth";
    const isManualOrbit = String(detail.sourceFormat || "").toUpperCase() === "MANUAL";
    const tabs = isGroundStation ? groundStationTabs : standardTabs;
    const rows = isGroundStation ? stationRows(detail) : details.rows;

    return <aside className="object-details-panel pointer-events-auto fixed top-[86px] right-[14px] bottom-[132px] z-[10124] flex min-h-[300px] w-[min(300px,calc(100vw-28px))] flex-col overflow-auto rounded-[10px] border border-[rgba(65,99,147,.58)] bg-[linear-gradient(145deg,rgba(12,25,42,.97),rgba(5,14,25,.97))] p-4 font-[system-ui] text-[#dbe7fa] shadow-[0_22px_60px_rgba(0,0,0,.46),inset_0_1px_rgba(255,255,255,.045)] max-[760px]:top-20 max-[760px]:right-2.5 max-[760px]:bottom-[74px] max-[760px]:w-[min(330px,calc(100vw-20px))]" aria-label="Detalles del objeto seleccionado">
        <button className="absolute top-[14px] right-[15px] cursor-pointer border-0 bg-transparent text-2xl leading-none text-[#b7c6dc] hover:text-white" type="button" aria-label="Cerrar detalles" onClick={() => setDismissedId(detail.id)}>&#215;</button>
        <h2 className="mb-[9px] max-w-[calc(100%_-_30px)] overflow-hidden text-ellipsis whitespace-nowrap text-[17px] leading-[1.2] font-medium text-[#f1f6ff]">{details.title}</h2>
        <div className="flex items-center gap-2.5 border-b border-[#1c2c43] pb-[17px] text-[11px] leading-none font-semibold tracking-[.03em] text-[#8fa1ba]">
            <span className={`inline-flex rounded-[5px] px-2 py-1.5 text-[10px] leading-none font-bold ${details.visible ? "bg-[rgba(39,169,95,.19)] text-[#73e3a0]" : "bg-[rgba(133,75,193,.24)] text-[#d2a8ff]"}`}>{details.visible ? "ACTIVE" : "HIDDEN"}</span>
            <span>{isCelestialBody ? "CUERPO DE REFERENCIA" : isGroundStation ? "OPERACIONES TERRESTRES" : `NORAD ${details.noradId}`}</span>
        </div>
        <nav className={`relative z-[1] my-[11px] mb-[13px] grid ${isGroundStation ? "grid-cols-4" : "grid-cols-5"} border-b border-[#1c2c43]`} aria-label="Secciones de detalle" role="tablist">
            {tabs.map(([key, label, title]) => <button className={`relative min-w-0 cursor-pointer border-0 bg-transparent px-0.5 pt-[9px] pb-[11px] text-[8px] leading-none font-bold tracking-[-.02em] ${tab === key ? "text-[#eaf1ff] after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-[#4476ff] after:shadow-[0_0_8px_#4476ff] after:content-['']" : "text-[#8d9bb1]"}`} type="button" key={key} role="tab" title={title} aria-label={title} aria-selected={tab === key} aria-controls={`object-details-${key}`} onClick={() => setTab(key)}>{label}</button>)}
        </nav>
        <section id={`object-details-${tab}`} role="tabpanel"><DetailRows rows={rows[tab] || []} /></section>
        {isGroundStation && <footer className="mt-auto grid grid-cols-2 gap-2 border-t border-[#1c2c43] pt-3"><button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" onClick={() => window.dispatchEvent(new CustomEvent("orbit:ground-station-passes-open", { detail: { stationId: detail.id } }))}>Tablas AOS / LOS</button><button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" onClick={() => dispatchObjectAction("visualization", detail.id)}>Configurar</button></footer>}
        {!isGroundStation && !isCelestialBody && <footer className={`mt-auto grid ${isManualOrbit ? "grid-cols-2" : "grid-cols-3"} gap-2 border-t border-[#1c2c43] pt-3`}>
            <button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" title="Configuración individual" onClick={() => dispatchObjectAction("visualization", detail.id)}><TuneGlyph /><span className="truncate">Configuración</span></button>
            <button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff] disabled:cursor-not-allowed disabled:opacity-45" type="button" title="Ver parámetros orbitales propagados" disabled={detail.active !== true} onClick={() => openPropagatedParameters(detail.id)}><PropagationGlyph /><span className="truncate">Propagados</span></button>
            {!isManualOrbit && <button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" title="Ver el archivo o la fuente de entrada" onClick={() => dispatchObjectAction("tle", detail.id)}><TleGlyph /><span className="truncate">Entrada</span></button>}
        </footer>}
    </aside>;
}
