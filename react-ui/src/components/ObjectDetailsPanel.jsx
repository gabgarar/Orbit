import { useEffect, useRef, useState } from "react";
import { buildObjectDetails } from "../features/objectDetails/detailRows.js";
import useSelectedObject from "../hooks/useSelectedObject.js";

const standardTabs = [["overview", "OVERVIEW"], ["orbit", "ORBIT"], ["telemetry", "TELEMETRY"]];
const toneClass = { "is-operational": "text-[#73e3a0]", "is-hidden": "text-[#d2a8ff]" };

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

function TuneGlyph() {
    return <svg className="size-3.5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /></svg>;
}

function TleGlyph() {
    return <svg className="size-3.5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
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
    const isManualOrbit = String(detail.sourceFormat || "").toUpperCase() === "MANUAL";
    const tabs = isManualOrbit ? [...standardTabs, ["manual", "MANUAL PARAMS"]] : standardTabs;

    return <aside className="object-details-panel pointer-events-auto fixed top-[86px] right-[14px] bottom-[132px] z-[10124] flex min-h-[300px] w-[min(300px,calc(100vw-28px))] flex-col overflow-auto rounded-[10px] border border-[rgba(65,99,147,.58)] bg-[linear-gradient(145deg,rgba(12,25,42,.97),rgba(5,14,25,.97))] p-4 font-[system-ui] text-[#dbe7fa] shadow-[0_22px_60px_rgba(0,0,0,.46),inset_0_1px_rgba(255,255,255,.045)] max-[760px]:top-20 max-[760px]:right-2.5 max-[760px]:bottom-[74px] max-[760px]:w-[min(330px,calc(100vw-20px))]" aria-label="Detalles del objeto seleccionado">
        <button className="absolute top-[14px] right-[15px] cursor-pointer border-0 bg-transparent text-2xl leading-none text-[#b7c6dc] hover:text-white" type="button" aria-label="Cerrar detalles" onClick={() => setDismissedId(detail.id)}>&#215;</button>
        <h2 className="mb-[9px] max-w-[calc(100%_-_30px)] overflow-hidden text-ellipsis whitespace-nowrap text-[17px] leading-[1.2] font-medium text-[#f1f6ff]">{details.title}</h2>
        <div className="flex items-center gap-2.5 border-b border-[#1c2c43] pb-[17px] text-[11px] leading-none font-semibold tracking-[.03em] text-[#8fa1ba]">
            <span className={`inline-flex rounded-[5px] px-2 py-1.5 text-[10px] leading-none font-bold ${details.visible ? "bg-[rgba(39,169,95,.19)] text-[#73e3a0]" : "bg-[rgba(133,75,193,.24)] text-[#d2a8ff]"}`}>{details.visible ? "ACTIVE" : "HIDDEN"}</span>
            <span>NORAD {details.noradId}</span>
        </div>
        <nav className={`relative z-[1] my-[11px] mb-[13px] grid ${isManualOrbit ? "grid-cols-4" : "grid-cols-3"} border-b border-[#1c2c43]`} aria-label="Secciones de detalle" role="tablist">
            {tabs.map(([key, label]) => <button className={`relative cursor-pointer border-0 bg-transparent px-0.5 pt-[9px] pb-[11px] text-[10px] leading-none font-bold ${tab === key ? "text-[#eaf1ff] after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-[#4476ff] after:shadow-[0_0_8px_#4476ff] after:content-['']" : "text-[#8d9bb1]"}`} type="button" key={key} role="tab" aria-selected={tab === key} aria-controls={`object-details-${key}`} onClick={() => setTab(key)}>{label}</button>)}
        </nav>
        <section id={`object-details-${tab}`} role="tabpanel"><DetailRows rows={details.rows[tab]} /></section>
        {!isGroundStation && <footer className={`mt-auto grid ${isManualOrbit ? "grid-cols-1" : "grid-cols-2"} gap-2 border-t border-[#1c2c43] pt-3`}>
            <button className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" title="Configuración individual" onClick={() => dispatchObjectAction("visualization", detail.id)}><TuneGlyph />Configuración</button>
            {!isManualOrbit && <button className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" title="Ver parámetros TLE" onClick={() => dispatchObjectAction("tle", detail.id)}><TleGlyph />Parámetros TLE</button>}
        </footer>}
    </aside>;
}
