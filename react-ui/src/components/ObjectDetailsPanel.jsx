import { useEffect, useMemo, useRef, useState } from "react";
import { buildObjectDetails } from "../features/objectDetails/detailRows.js";
import useSelectedObject from "../hooks/useSelectedObject.js";
import { emitPropagatedParametersOpen } from "../../../front/js/runtime/propagatedParametersEvents.js";
import {
    calculatePatternGainDbi,
    calculateStationRfModel,
    sampleAntennaPattern,
    sampleSatelliteDownlinkPattern
} from "../../../front/js/features/groundStations/rfModel.js";
import PanelCloseButton from "./PanelCloseButton.jsx";

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
    ["rf", "RF", "RF system and link budget"],
    ["pattern", "PATTERN", "Antenna radiation pattern"]
];
const toneClass = { "is-operational": "text-[#73e3a0]", "is-hidden": "text-[#d2a8ff]" };

function number(input, digits = 1) {
    return Number.isFinite(Number(input)) ? Number(input).toFixed(digits) : "-";
}

function utc(input) {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? "-" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function getStationRfModel(detail) {
    const station = detail?.telemetry?.station || detail?.station || {};
    return calculateStationRfModel({ ...station, ...(station.rf || {}) });
}

function stationRows(detail) {
    const telemetry = detail.telemetry || {};
    const station = telemetry.station || detail.station || {};
    const rf = getStationRfModel(detail);
    const realtime = telemetry.realtime || {};
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
        rf: [
            ["Antena", `${number(rf.antenna_diameter_m, 2)} m · ${number(rf.antenna_efficiency * 100, 0)} %`],
            ["Patrón / polarización", `${rf.pattern_type === "cosine" ? "cos^n" : "Gaussiano"} · ${rf.polarization}`],
            ["Frecuencia", `${number(rf.frequency_mhz, 3)} MHz`],
            ["Potencia TX", `${number(rf.tx_power_dbm, 2)} dBm · ${number(rf.tx_power_w, 3)} W`],
            ["Ganancia máxima", `${number(rf.gain_max_dbi, 2)} dBi`],
            ["Ganancia TX efectiva", `${number(rf.tx_effective_gain_dbi, 2)} dBi`],
            ["Ganancia RX efectiva", `${number(rf.rx_effective_gain_dbi, 2)} dBi`],
            ["HPBW azimut / elev.", `${number(rf.hpbw_azimuth_deg, 2)}° / ${number(rf.hpbw_elevation_deg, 2)}°`],
            ["Pérdida de apuntado", `${number(rf.pointing_loss_db, 3)} dB`],
            ["Temperatura de sistema", `${number(rf.system_temperature_k, 1)} K`],
            ["Ancho de banda RX", `${number(rf.receiver_bandwidth_hz, 0)} Hz`],
            ["G/T", `${number(rf.system_gt_db_per_k, 2)} dB/K`],
            ["Ruido kTB", `${number(rf.receiver_noise_floor_dbm, 2)} dBm`],
            ["Pérdidas del sistema", `${number(rf.total_system_loss_db, 2)} dB`],
            ["Máscara de elevación", `${number(rf.min_elevation_deg, 1)}°`],
            ["Envolvente de diseño", `${number(rf.max_range_km, 1)} km`, "is-operational"],
            ["Contrato de alcance", rf.range_contract === "reference-terminal" ? "Terminal de referencia" : "Planificación recíproca"]
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

function StationSnrPattern({ model, linkContext }) {
    const profile = linkContext?.satelliteRfProfile;
    const rangeKm = Number(linkContext?.rangeKm);
    const sampled = useMemo(
        () => sampleSatelliteDownlinkPattern(model, profile, rangeKm, { azimuthSamples: 18, elevationSamples: 10 }),
        [
            model,
            profile?.eirp_dbm,
            profile?.frequency_mhz,
            profile?.frequency_hz,
            profile?.polarization,
            profile?.polarization_tilt_deg,
            profile?.bandwidth_hz,
            rangeKm
        ]
    );
    const width = 300;
    const height = 132;
    const pad = { left: 28, right: 12, top: 20, bottom: 25 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const columns = sampled.azimuth_samples ? sampled.azimuth_samples + 1 : 0;
    const rows = sampled.elevation_samples ? sampled.elevation_samples + 1 : 0;
    const cellWidth = columns ? plotWidth / columns : 0;
    const cellHeight = rows ? plotHeight / rows : 0;
    const finiteMargins = sampled.samples
        .map((sample) => Number(sample.snr_margin_db))
        .filter(Number.isFinite);
    const minMargin = finiteMargins.length ? Math.min(-12, ...finiteMargins) : -12;
    const maxMargin = finiteMargins.length ? Math.max(12, ...finiteMargins) : 12;
    const colorForMargin = (margin) => {
        const value = Number(margin);
        if (!Number.isFinite(value)) return "#172336";
        if (value < 0) {
            const fraction = Math.max(0, Math.min(1, (value - minMargin) / (0 - minMargin)));
            return `hsl(${7 + fraction * 35} 76% ${25 + fraction * 26}%)`;
        }
        const fraction = Math.max(0, Math.min(1, value / maxMargin));
        return `hsl(${126 + fraction * 24} 67% ${29 + fraction * 22}%)`;
    };

    if (!profile || !Number.isFinite(rangeKm) || rangeKm <= 0) {
        return <div className="mt-3 rounded-[8px] border border-dashed border-[rgba(56,87,127,.72)] bg-[rgba(7,19,35,.5)] px-3 py-2.5 text-[9px] leading-[1.45] text-[#8499ba]">
            El mapa de SNR se habilita al analizar una capa que publique EIRP, frecuencia, polarización y ancho de banda RF.
        </div>;
    }

    if (!sampled.available) {
        return <div className="mt-3 rounded-[8px] border border-[rgba(167,104,65,.68)] bg-[rgba(50,29,20,.42)] px-3 py-2.5 text-[9px] leading-[1.45] text-[#e2b894]">
            No se puede dibujar el mapa de SNR para este enlace: {sampled.reason || "perfil RF incompatible"}.
        </div>;
    }

    return <figure className="mt-3 overflow-hidden rounded-[8px] border border-[rgba(56,87,127,.78)] bg-[linear-gradient(160deg,rgba(8,22,40,.96),rgba(5,14,26,.9))] p-2.5" aria-label="Mapa angular de margen SNR del enlace descendente">
        <figcaption className="mb-1.5 flex items-baseline justify-between gap-2 text-[10px] font-bold tracking-[.02em] text-[#dce8fb]">
            <span>Mapa angular de margen SNR</span>
            <span className="whitespace-nowrap text-[8.5px] font-semibold text-[#8ca3c9]">{number(rangeKm, 1)} km</span>
        </figcaption>
        <svg className="block h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Margen SNR de enlace descendente respecto al boresight">
            <rect x={pad.left} y={pad.top} width={plotWidth} height={plotHeight} rx="3" fill="#09172a" stroke="#29425f" strokeWidth="0.8" />
            {sampled.samples.map((sample, index) => {
                const column = index % columns;
                const row = Math.floor(index / columns);
                return <rect key={`${sample.azimuth_offset_deg}-${sample.elevation_offset_deg}`} x={pad.left + column * cellWidth} y={pad.top + (rows - 1 - row) * cellHeight} width={cellWidth + 0.2} height={cellHeight + 0.2} fill={colorForMargin(sample.snr_margin_db)} opacity="0.94">
                    <title>{`Δaz ${number(sample.azimuth_offset_deg, 1)}°, Δel ${number(sample.elevation_offset_deg, 1)}° · P_RX ${number(sample.received_power_dbm, 1)} dBm · SNR ${number(sample.snr_db, 1)} dB · margen ${number(sample.snr_margin_db, 1)} dB`}</title>
                </rect>;
            })}
            <line x1={pad.left + plotWidth / 2} x2={pad.left + plotWidth / 2} y1={pad.top} y2={pad.top + plotHeight} stroke="#eef6ff" strokeOpacity="0.5" strokeWidth="0.7" />
            <line x1={pad.left} x2={pad.left + plotWidth} y1={pad.top + plotHeight / 2} y2={pad.top + plotHeight / 2} stroke="#eef6ff" strokeOpacity="0.5" strokeWidth="0.7" />
            <text x={pad.left} y={height - 8} fill="#93a7c6" fontSize="8">−{number(sampled.max_offset_deg, 1)}°</text>
            <text x={pad.left + plotWidth / 2} y={height - 8} fill="#c4d3eb" fontSize="8" textAnchor="middle">azimut relativo</text>
            <text x={pad.left + plotWidth} y={height - 8} fill="#93a7c6" fontSize="8" textAnchor="end">+{number(sampled.max_offset_deg, 1)}°</text>
            <text x="5" y={pad.top + 5} fill="#93a7c6" fontSize="7.5">+el</text>
            <text x="5" y={pad.top + plotHeight} fill="#93a7c6" fontSize="7.5">−el</text>
        </svg>
        <div className="mt-1 flex items-center justify-between gap-3 text-[8.5px] font-semibold text-[#91a8cd]"><span className="text-[#e4a16e]">Rojo: no cierra</span><span className="text-[#79df9d]">Verde: margen ≥ 0 dB</span></div>
        <p className="mt-1.5 text-[9px] leading-[1.4] text-[#8094b3]">Muestra angular del enlace de bajada hacia {linkContext?.satelliteName || "el satélite seleccionado"}. Cada celda usa potencia recibida y SNR; no representa relieve ni disponibilidad sobre la Tierra.</p>
    </figure>;
}

function StationPattern({ model, linkContext }) {
    const peakGain = Number(model.tx_effective_gain_dbi ?? model.gain_max_dbi);
    const safePeakGain = Number.isFinite(peakGain) ? peakGain : 0;
    const maxOffsetDeg = Math.min(90, Math.max(8, Math.max(model.hpbw_azimuth_deg, model.hpbw_elevation_deg) * 3));
    const sideLobeLevelDb = Math.max(3, Number(model.side_lobe_level_db) || 0);
    const floorGain = safePeakGain - sideLobeLevelDb;
    const graph = { left: 27, right: 274, top: 18, bottom: 112 };
    const samples = Array.from({ length: 61 }, (_, index) => {
        const angleDeg = -maxOffsetDeg + ((2 * maxOffsetDeg * index) / 60);
        const gainDbi = calculatePatternGainDbi({
            peakGainDbi: safePeakGain,
            patternType: model.pattern_type,
            hpbwAzimuthDeg: model.hpbw_azimuth_deg,
            hpbwElevationDeg: model.hpbw_elevation_deg,
            sideLobeLevelDb,
            azimuthOffsetDeg: angleDeg,
            elevationOffsetDeg: 0
        });
        return { angleDeg, gainDbi: Number.isFinite(gainDbi) ? gainDbi : floorGain };
    });
    const elevationSamples = Array.from({ length: 61 }, (_, index) => {
        const angleDeg = -maxOffsetDeg + ((2 * maxOffsetDeg * index) / 60);
        const gainDbi = calculatePatternGainDbi({
            peakGainDbi: safePeakGain,
            patternType: model.pattern_type,
            hpbwAzimuthDeg: model.hpbw_azimuth_deg,
            hpbwElevationDeg: model.hpbw_elevation_deg,
            sideLobeLevelDb,
            azimuthOffsetDeg: 0,
            elevationOffsetDeg: angleDeg
        });
        return { angleDeg, gainDbi: Number.isFinite(gainDbi) ? gainDbi : floorGain };
    });
    const gainSpan = Math.max(6, safePeakGain - floorGain);
    const x = (angleDeg) => graph.left + ((angleDeg + maxOffsetDeg) / (2 * maxOffsetDeg)) * (graph.right - graph.left);
    const y = (gainDbi) => graph.bottom - ((gainDbi - floorGain) / gainSpan) * (graph.bottom - graph.top);
    const curve = samples.map(({ angleDeg, gainDbi }, index) => `${index === 0 ? "M" : "L"}${x(angleDeg).toFixed(2)},${y(gainDbi).toFixed(2)}`).join(" ");
    const elevationCurve = elevationSamples.map(({ angleDeg, gainDbi }, index) => `${index === 0 ? "M" : "L"}${x(angleDeg).toFixed(2)},${y(gainDbi).toFixed(2)}`).join(" ");
    const minusThreeGain = safePeakGain - 3;
    const hpbwHalf = Math.min(maxOffsetDeg, Math.max(model.hpbw_azimuth_deg, model.hpbw_elevation_deg) / 2);
    const titleId = "station-pattern-title";
    const descriptionId = "station-pattern-description";
    const sampledPattern = sampleAntennaPattern(model, { azimuthSamples: 18, elevationSamples: 10 });
    const heatmapColumns = sampledPattern.azimuth_samples + 1;
    const heatmapRows = sampledPattern.elevation_samples + 1;
    const heatmapWidth = 300;
    const heatmapHeight = 132;
    const heatmapPad = { left: 28, right: 12, top: 20, bottom: 25 };
    const heatmapPlotWidth = heatmapWidth - heatmapPad.left - heatmapPad.right;
    const heatmapPlotHeight = heatmapHeight - heatmapPad.top - heatmapPad.bottom;
    const heatmapCellWidth = heatmapPlotWidth / heatmapColumns;
    const heatmapCellHeight = heatmapPlotHeight / heatmapRows;
    const heatmapColor = (gainDbi) => {
        const fraction = Math.max(0, Math.min(1, (Number(gainDbi) - floorGain) / gainSpan));
        const hue = 224 - (fraction * 105);
        const lightness = 17 + (fraction * 44);
        return `hsl(${hue} 82% ${lightness}%)`;
    };

    return <div className="pb-[14px]">
        <div className="mb-3 rounded-[7px] border border-[rgba(54,90,133,.8)] bg-[rgba(7,19,35,.66)] px-3 py-2.5 text-[10px] leading-[1.45] text-[#9aacc5]">
            Cortes azimutal y de elevación del patrón de TX alrededor del boresight. El mismo modelo <code className="rounded bg-[#132440] px-1 py-px text-[#bbcbec]">G(θ, φ)</code> alimenta la envolvente de planificación.
        </div>
        <figure className="overflow-hidden rounded-[8px] border border-[rgba(56,87,127,.78)] bg-[linear-gradient(160deg,rgba(8,22,40,.96),rgba(5,14,26,.9))] p-2.5" aria-labelledby={titleId}>
            <figcaption id={titleId} className="mb-1.5 flex items-baseline justify-between gap-2 text-[10px] font-bold tracking-[.02em] text-[#dce8fb]">
                <span>Cortes de ganancia TX</span>
                <span className="whitespace-nowrap text-[9px] font-semibold text-[#8ca3c9]">{model.pattern_type === "cosine" ? "cos^n" : "Gaussiano"}</span>
            </figcaption>
            <svg className="block h-auto w-full" viewBox="0 0 300 144" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
                <desc id={descriptionId}>Ganancia de transmisión en dBi frente al error angular. Azul: corte de azimut. Morado: corte de elevación. La línea punteada representa menos tres decibelios y las líneas verticales marcan la semianchura de haz azimutal a media potencia.</desc>
                <defs>
                    <linearGradient id="station-pattern-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#668cff" stopOpacity="0.38" />
                        <stop offset="100%" stopColor="#668cff" stopOpacity="0" />
                    </linearGradient>
                </defs>
                {[0, 0.5, 1].map((fraction) => {
                    const lineY = graph.top + fraction * (graph.bottom - graph.top);
                    return <line key={fraction} x1={graph.left} y1={lineY} x2={graph.right} y2={lineY} stroke="#2a4262" strokeOpacity="0.72" strokeWidth="0.75" />;
                })}
                <line x1={x(-hpbwHalf)} y1={graph.top} x2={x(-hpbwHalf)} y2={graph.bottom} stroke="#7186bf" strokeOpacity="0.62" strokeDasharray="3 3" strokeWidth="0.75" />
                <line x1={x(hpbwHalf)} y1={graph.top} x2={x(hpbwHalf)} y2={graph.bottom} stroke="#7186bf" strokeOpacity="0.62" strokeDasharray="3 3" strokeWidth="0.75" />
                <line x1={graph.left} y1={y(minusThreeGain)} x2={graph.right} y2={y(minusThreeGain)} stroke="#f3bd55" strokeOpacity="0.85" strokeDasharray="3 3" strokeWidth="0.8" />
                <path d={`${curve} L${graph.right},${graph.bottom} L${graph.left},${graph.bottom} Z`} fill="url(#station-pattern-fill)" />
                <path d={curve} fill="none" stroke="#7ea4ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d={elevationCurve} fill="none" stroke="#b18aff" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
                <line x1={graph.left} y1={graph.bottom} x2={graph.right} y2={graph.bottom} stroke="#506b92" strokeWidth="0.8" />
                <text x={graph.left} y="130" fill="#93a7c6" fontSize="8">−{number(maxOffsetDeg, 1)}°</text>
                <text x="150" y="130" fill="#c4d3eb" fontSize="8" textAnchor="middle">Boresight</text>
                <text x={graph.right} y="130" fill="#93a7c6" fontSize="8" textAnchor="end">+{number(maxOffsetDeg, 1)}°</text>
                <text x={graph.left} y="12" fill="#cad8ee" fontSize="8">{number(safePeakGain, 1)} dBi</text>
                <text x={graph.right} y={y(minusThreeGain) - 3} fill="#eabe64" fontSize="7.5" textAnchor="end">−3 dB</text>
                <text x={graph.right} y="12" fill="#8fa5c7" fontSize="7.5" textAnchor="end">HPBW {number(model.hpbw_azimuth_deg, 2)}°</text>
            </svg>
            <div className="mt-1 flex gap-3 px-0.5 text-[8.5px] font-semibold text-[#91a8cd]"><span><i className="mr-1 inline-block size-1.5 rounded-full bg-[#7ea4ff]" />Azimut</span><span><i className="mr-1 inline-block size-1.5 rounded-full bg-[#b18aff]" />Elevación</span></div>
            <p className="mt-1.5 text-[9px] leading-[1.4] text-[#8094b3]">Límites mecánicos, máscara y modo de operación siguen aplicándose aparte; estos cortes describen únicamente la directividad de la antena.</p>
        </figure>
        <figure className="mt-3 overflow-hidden rounded-[8px] border border-[rgba(56,87,127,.78)] bg-[linear-gradient(160deg,rgba(8,22,40,.96),rgba(5,14,26,.9))] p-2.5" aria-label="Mapa angular discreto de ganancia de antena">
            <figcaption className="mb-1.5 flex items-baseline justify-between gap-2 text-[10px] font-bold tracking-[.02em] text-[#dce8fb]"><span>Mapa angular de ganancia</span><span className="text-[8.5px] font-semibold text-[#8ca3c9]">G(θ, φ) · TX</span></figcaption>
            <svg className="block h-auto w-full" viewBox={`0 0 ${heatmapWidth} ${heatmapHeight}`} role="img" aria-label="Mapa de ganancia respecto al boresight en azimut y elevación">
                <rect x={heatmapPad.left} y={heatmapPad.top} width={heatmapPlotWidth} height={heatmapPlotHeight} rx="3" fill="#09172a" stroke="#29425f" strokeWidth="0.8" />
                {sampledPattern.samples.map((sample, index) => {
                    const column = index % heatmapColumns;
                    const row = Math.floor(index / heatmapColumns);
                    return <rect key={`${sample.azimuth_offset_deg}-${sample.elevation_offset_deg}`} x={heatmapPad.left + column * heatmapCellWidth} y={heatmapPad.top + (heatmapRows - 1 - row) * heatmapCellHeight} width={heatmapCellWidth + 0.2} height={heatmapCellHeight + 0.2} fill={heatmapColor(sample.gain_dbi)} opacity="0.94" />;
                })}
                <line x1={heatmapPad.left + heatmapPlotWidth / 2} x2={heatmapPad.left + heatmapPlotWidth / 2} y1={heatmapPad.top} y2={heatmapPad.top + heatmapPlotHeight} stroke="#eef6ff" strokeOpacity="0.5" strokeWidth="0.7" />
                <line x1={heatmapPad.left} x2={heatmapPad.left + heatmapPlotWidth} y1={heatmapPad.top + heatmapPlotHeight / 2} y2={heatmapPad.top + heatmapPlotHeight / 2} stroke="#eef6ff" strokeOpacity="0.5" strokeWidth="0.7" />
                <text x={heatmapPad.left} y={heatmapHeight - 8} fill="#93a7c6" fontSize="8">−{number(sampledPattern.max_offset_deg, 1)}°</text>
                <text x={heatmapPad.left + heatmapPlotWidth / 2} y={heatmapHeight - 8} fill="#c4d3eb" fontSize="8" textAnchor="middle">azimut relativo</text>
                <text x={heatmapPad.left + heatmapPlotWidth} y={heatmapHeight - 8} fill="#93a7c6" fontSize="8" textAnchor="end">+{number(sampledPattern.max_offset_deg, 1)}°</text>
                <text x="5" y={heatmapPad.top + 5} fill="#93a7c6" fontSize="7.5">+el</text>
                <text x="5" y={heatmapPad.top + heatmapPlotHeight} fill="#93a7c6" fontSize="7.5">−el</text>
            </svg>
            <p className="mt-1.5 text-[9px] leading-[1.4] text-[#8094b3]">Mapa discreto de directividad, no de disponibilidad sobre el terreno. Un mapa de SNR solo se habilita cuando el satélite aporta EIRP, canal, polarización y ancho de banda.</p>
        </figure>
        <StationSnrPattern model={model} linkContext={linkContext} />
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
    const [stationDesignMode, setStationDesignMode] = useState(false);
    const [stationLinkContext, setStationLinkContext] = useState(null);
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
            setStationLinkContext(null);
        }
    }, [selectedDetail]);

    useEffect(() => {
        const onDesignMode = (event) => setDesignMode(event.detail?.active === true);
        window.addEventListener("orbit:manual-orbit-design-state", onDesignMode);
        return () => window.removeEventListener("orbit:manual-orbit-design-state", onDesignMode);
    }, []);

    useEffect(() => {
        const onStationDesign = (event) => setStationDesignMode(event.detail?.active === true);
        window.addEventListener("orbit:ground-station-design-state", onStationDesign);
        return () => window.removeEventListener("orbit:ground-station-design-state", onStationDesign);
    }, []);

    useEffect(() => {
        const onGroundStationAnalysis = (event) => {
            const payload = event.detail || {};
            const stationId = String(payload.analysisSelection?.stationId || "");
            if (!detail?.id || stationId !== String(detail.id)) return;
            setStationLinkContext({
                stationId,
                satelliteName: payload.satelliteName || "",
                satelliteRfProfile: payload.satelliteRfProfile || null,
                rangeKm: Number(payload.rangeKm)
            });
        };
        window.addEventListener("orbit:ground-stations-analysis-result", onGroundStationAnalysis);
        return () => window.removeEventListener("orbit:ground-stations-analysis-result", onGroundStationAnalysis);
    }, [detail?.id]);

    if (designMode || stationDesignMode || !detail || dismissedId === detail.id) return null;

    const details = buildObjectDetails(detail);
    const isGroundStation = String(detail.layerType || "").toUpperCase() === "GROUND_STATION";
    const isCelestialBody = ["CELESTIAL_BODY", "EARTH"].includes(String(detail.layerType || "").toUpperCase())
        || String(detail.id || "").toLowerCase() === "body:earth";
    const isManualOrbit = String(detail.sourceFormat || "").toUpperCase() === "MANUAL";
    const tabs = isGroundStation ? groundStationTabs : standardTabs;
    const rows = isGroundStation ? stationRows(detail) : details.rows;
    const stationRfModel = isGroundStation ? getStationRfModel(detail) : null;

    return <aside className="object-details-panel orbit-right-panel pointer-events-auto fixed z-[10124] flex min-h-[300px] flex-col overflow-auto border p-4 font-[system-ui] text-[#dbe7fa]" aria-label="Detalles del objeto seleccionado">
        <PanelCloseButton className="absolute top-[14px] right-[15px]" label="Cerrar detalles" onClick={() => setDismissedId(detail.id)} />
        <h2 className="mb-[9px] max-w-[calc(100%_-_30px)] overflow-hidden text-ellipsis whitespace-nowrap text-[17px] leading-[1.2] font-medium text-[#f1f6ff]">{details.title}</h2>
        <div className="flex items-center gap-2.5 border-b border-[#1c2c43] pb-[17px] text-[11px] leading-none font-semibold tracking-[.03em] text-[#8fa1ba]">
            <span className={`inline-flex rounded-[5px] px-2 py-1.5 text-[10px] leading-none font-bold ${details.visible ? "bg-[rgba(39,169,95,.19)] text-[#73e3a0]" : "bg-[rgba(133,75,193,.24)] text-[#d2a8ff]"}`}>{details.visible ? "ACTIVE" : "HIDDEN"}</span>
            <span>{isCelestialBody ? "CUERPO DE REFERENCIA" : isGroundStation ? "OPERACIONES TERRESTRES" : `NORAD ${details.noradId}`}</span>
        </div>
        <nav className={`relative z-[1] my-[11px] mb-[13px] grid ${isGroundStation ? "grid-cols-4" : "grid-cols-5"} border-b border-[#1c2c43]`} aria-label="Secciones de detalle" role="tablist">
            {tabs.map(([key, label, title]) => <button className={`relative min-w-0 cursor-pointer border-0 bg-transparent px-0.5 pt-[9px] pb-[11px] text-[8px] leading-none font-bold tracking-[-.02em] ${tab === key ? "text-[#eaf1ff] after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-[#4476ff] after:shadow-[0_0_8px_#4476ff] after:content-['']" : "text-[#8d9bb1]"}`} type="button" key={key} role="tab" title={title} aria-label={title} aria-selected={tab === key} aria-controls={`object-details-${key}`} onClick={() => setTab(key)}>{label}</button>)}
        </nav>
        <section id={`object-details-${tab}`} role="tabpanel">
            {isGroundStation && tab === "pattern"
                ? <StationPattern model={stationRfModel} linkContext={stationLinkContext} />
                : <DetailRows rows={rows[tab] || []} />}
        </section>
        {isGroundStation && <footer className="mt-auto grid grid-cols-2 gap-2 border-t border-[#1c2c43] pt-3"><button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" onClick={() => window.dispatchEvent(new CustomEvent("orbit:ground-station-passes-open", { detail: { stationId: detail.id } }))}>Tablas AOS / LOS</button><button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" onClick={() => dispatchObjectAction("visualization", detail.id)}>Configurar</button></footer>}
        {!isGroundStation && !isCelestialBody && <footer className={`mt-auto grid ${isManualOrbit ? "grid-cols-2" : "grid-cols-3"} gap-2 border-t border-[#1c2c43] pt-3`}>
            <button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" title="Configuración individual" onClick={() => dispatchObjectAction("visualization", detail.id)}><TuneGlyph /><span className="truncate">Configuración</span></button>
            <button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff] disabled:cursor-not-allowed disabled:opacity-45" type="button" title="Ver efemérides" disabled={detail.active !== true} onClick={() => openPropagatedParameters(detail.id)}><PropagationGlyph /><span className="truncate">Efemérides</span></button>
            {!isManualOrbit && <button className="inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-[#294464] bg-[#0b1829] px-2 py-2 text-[10px] leading-none font-bold text-[#9dc0ff] hover:border-[#416a9f] hover:bg-[#11213a] hover:text-[#e4eeff]" type="button" title="Ver el archivo o la fuente de entrada" onClick={() => dispatchObjectAction("tle", detail.id)}><TleGlyph /><span className="truncate">Entrada</span></button>}
        </footer>}
    </aside>;
}
