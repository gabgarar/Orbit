import { useEffect, useId, useMemo, useState } from "react";
import { getPassTimelinePresentation } from "../../../../front/js/features/groundStations/passTimelinePresentation.js";

function text(value, fallback = "—") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
}

function relatedEvent(marker, eventType) {
    return marker.relatedEvents.find((event) => event.eventType === eventType) || null;
}

function markerLabel(marker, formatTime) {
    const station = text(marker.stationName || marker.stationId, "estación terrestre");
    const satellite = text(marker.satelliteName || marker.satelliteId, "satélite");
    const elevation = marker.eventType === "max" && Number.isFinite(marker.elevationDeg)
        ? `, elevación máxima ${marker.elevationDeg.toFixed(1)} grados`
        : "";
    return `${marker.label} del pase entre ${satellite} y ${station}: ${formatTime(marker.time)}${elevation}. Ir a este instante.`;
}

function tooltipStyle(position) {
    if (position <= 10) return "translate-x-0";
    if (position >= 90) return "-translate-x-full";
    return "-translate-x-1/2";
}

/**
 * Compact, direct-manipulation presentation of pass milestones.  Maximum
 * elevation samples occupy the upper lane in green.  AOS and LOS occupy the
 * lower lane in purple; every glyph is a real button so mouse and keyboard
 * users can inspect and seek to the exact UTC sample.
 */
export default function PassTimelineMarkers({ events, startDate, endDate, formatTime, onJump }) {
    const [hoveredMarker, setHoveredMarker] = useState(null);
    const tooltipId = useId();
    const markers = useMemo(
        () => getPassTimelinePresentation(events, startDate, endDate),
        [events, startDate, endDate]
    );
    const maximumMarkers = markers.filter((marker) => marker.eventType === "max");
    const boundaryMarkers = markers.filter((marker) => marker.eventType === "aos" || marker.eventType === "los");
    const activeMarker = hoveredMarker && markers.find((marker) => marker.id === hoveredMarker.id) || null;

    useEffect(() => { setHoveredMarker(null); }, [events, startDate, endDate]);

    if (!markers.length) return null;

    const markerButton = (marker, lane) => {
        const isMaximum = marker.eventType === "max";
        const isAos = marker.eventType === "aos";
        return <button
            key={marker.id}
            className={isMaximum
                ? "pointer-events-auto absolute top-0 h-[14px] w-[16px] -translate-x-1/2 cursor-pointer border-0 bg-transparent p-0 before:absolute before:top-[1px] before:left-1/2 before:h-[13px] before:w-[2px] before:-translate-x-1/2 before:rounded before:bg-[#67ed9d] before:shadow-[0_0_7px_rgba(103,237,157,.8)] before:transition-colors hover:before:bg-[#a7ffc5] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9bf8ba]"
                : "pointer-events-auto absolute top-0 h-[14px] w-[16px] -translate-x-1/2 cursor-pointer border-0 bg-transparent p-0 before:absolute before:top-0 before:left-1/2 before:h-[12px] before:w-[2px] before:-translate-x-1/2 before:rounded before:bg-[#be8cff] before:shadow-[0_0_7px_rgba(190,140,255,.72)] before:transition-colors hover:before:bg-[#dac0ff] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#d7bbff] after:absolute after:top-[9px] after:left-1/2 after:size-[5px] after:-translate-x-1/2 after:rotate-45 after:border after:border-[#d4adff] after:bg-[#7b4fb9] after:content-['']"
            }
            data-pass-event={marker.eventType}
            data-pass-lane={lane}
            type="button"
            aria-label={markerLabel(marker, formatTime)}
            aria-describedby={activeMarker?.id === marker.id ? tooltipId : undefined}
            onPointerEnter={() => setHoveredMarker(marker)}
            onPointerLeave={() => setHoveredMarker((current) => current?.id === marker.id ? null : current)}
            onFocus={() => setHoveredMarker(marker)}
            onBlur={() => setHoveredMarker((current) => current?.id === marker.id ? null : current)}
            onClick={() => onJump(marker)}
            style={{ left: `${marker.position}%`, ...(isAos ? { marginLeft: "-2px" } : marker.eventType === "los" ? { marginLeft: "2px" } : {}) }}
        />;
    };

    const aos = activeMarker && relatedEvent(activeMarker, "aos");
    const los = activeMarker && relatedEvent(activeMarker, "los");
    const maximum = activeMarker && relatedEvent(activeMarker, "max");

    return <>
        {activeMarker && <aside
            id={tooltipId}
            role="tooltip"
            className={`pointer-events-none absolute bottom-[calc(100%+9px)] z-20 w-[min(286px,calc(100vw-40px))] rounded-[8px] border border-[#625080] bg-[linear-gradient(145deg,rgba(20,15,38,.98),rgba(5,16,27,.985))] px-3 py-2.5 font-[system-ui,sans-serif] text-[10px] leading-[1.35] text-[#e9defa] shadow-[0_14px_34px_rgba(0,0,0,.48)] ${tooltipStyle(activeMarker.position)}`}
            style={{ left: `${activeMarker.position}%` }}
        >
            <div className="flex items-center justify-between gap-3"><strong className="text-[11px] text-[#fff5ff]">{activeMarker.label}</strong><span className={activeMarker.eventType === "max" ? "shrink-0 text-[#89e7ae]" : "shrink-0 text-[#d6b7ff]"}>{formatTime(activeMarker.time)}</span></div>
            <p className="mt-1 mb-2 truncate text-[#cbbde1]">{text(activeMarker.satelliteName || activeMarker.satelliteId, "Satélite")} <span className="text-[#89789f]">·</span> {text(activeMarker.stationName || activeMarker.stationId, "Estación terrestre")}</p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-y border-[#493a61] py-1.5"><dt className="text-[#bea7dd]">AOS</dt><dd className="m-0 text-right font-semibold text-[#eee4fb]">{aos ? formatTime(aos.time) : "—"}</dd><dt className="text-[#bea7dd]">LOS</dt><dd className="m-0 text-right font-semibold text-[#eee4fb]">{los ? formatTime(los.time) : "—"}</dd><dt className="text-[#bea7dd]">Máx.</dt><dd className="m-0 text-right font-semibold text-[#8fe8b2]">{maximum ? `${Number.isFinite(maximum.elevationDeg) ? `${maximum.elevationDeg.toFixed(1)}° · ` : ""}${formatTime(maximum.time)}` : "—"}</dd></dl>
            <p className="mt-2 mb-0 text-[#c3b0dd]">Pulsa para situar la simulación en este instante.</p>
        </aside>}
        {maximumMarkers.length > 0 && <div className="pointer-events-none absolute top-[9px] right-0 left-0 z-[4] h-[14px]" aria-label="Máximos de elevación calculados">
            {maximumMarkers.map((marker) => markerButton(marker, "upper"))}
        </div>}
        {boundaryMarkers.length > 0 && <div className="pointer-events-none absolute top-[27px] right-0 left-0 z-[4] h-[14px]" aria-label="Eventos AOS y LOS calculados">
            {boundaryMarkers.map((marker) => markerButton(marker, "lower"))}
        </div>}
    </>;
}
