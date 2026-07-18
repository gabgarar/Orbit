import { createLayerTree } from "./features/layers/layerTree.js";

function formatNumber(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return "-";
    }
    return n.toFixed(decimals);
}

const INFO_FIELD_HELP = {
    "Nombre": "Nombre visible de la capa/objeto en el panel.",
    "Latitud": "Coordenada geodesica norte/sur en grados decimales.",
    "Longitud": "Coordenada geodesica este/oeste en grados decimales.",
    "Altitud": "Altura sobre el elipsoide de referencia.",
    "Mascara elev.": "Elevacion minima para considerar visibilidad util de enlace.",
    "Satelites visibles": "Numero de satelites por encima de la mascara de elevacion en este instante.",
    "Satelites activos": "Numero de satelites activos considerados en el calculo de visibilidad.",
    "Mejor elevacion": "Mayor elevacion angular instantanea entre los satelites visibles.",
    "Mejor rango": "Distancia al satelite visible con mejor elevacion.",
    "Mejor enlace": "Estimacion simple de potencia recibida usando perdida de espacio libre.",
    "Frecuencia": "Frecuencia central usada para la estimacion del enlace.",
    "Potencia TX": "Potencia de transmision de la estacion en dBm.",
    "Ganancia TX": "Ganancia de antena transmisora en dBi.",
    "Ganancia RX": "Ganancia de antena receptora en dBi.",
    "Velocidad": "Modulo de velocidad instantanea del satelite.",
    "Distancia a camara": "Distancia geometrica desde el objeto a la camara actual.",
    "Edad telemetria": "Tiempo transcurrido desde la ultima muestra de telemetria recibida.",
    "Fuente orbital": "Formato de datos de la orbita (TLE/OMM/OEM/otros).",
    "Propagacion": "Metodo de propagacion usado para posicionar el objeto.",
    "Tipo orbita": "Clasificacion orbital aproximada (LEO/MEO/GEO/HEO).",
    "Tipo de orbita": "Clasificacion orbital aproximada (LEO/MEO/GEO/HEO).",
    "Edad TLE": "Antiguedad del elemento TLE frente al tiempo actual.",
    "Ventana recomendada": "Rango temporal recomendado para mantener precision de propagacion."
};

function getInfoHelp(label) {
    return INFO_FIELD_HELP[String(label || "")] || "Informacion de campo de telemetria en tiempo real.";
}

function row(label, value, unit = "", helpText = "") {
    const tooltip = escapeHtml(helpText || getInfoHelp(label));
    return `
        <div class="object-info-row" title="${tooltip}">
            <span class="object-info-key" title="${tooltip}">${label}</span>
            <span class="object-info-value" title="${tooltip}">${value}${unit}</span>
        </div>
    `;
}

function section(sectionKey, title, rowsHtml, isOpen = true) {
    const expanded = isOpen !== false;
    return `
        <section class="object-info-section${expanded ? "" : " is-collapsed"}" data-info-section="${sectionKey}">
            <button class="object-info-section-toggle" type="button" data-info-toggle="${sectionKey}" aria-expanded="${expanded ? "true" : "false"}">
                <span class="object-info-section-title">${title}</span>
                <span class="object-info-section-caret">${expanded ? "▾" : "▸"}</span>
            </button>
            <div class="object-info-grid"${expanded ? "" : " hidden"}>${rowsHtml}</div>
        </section>
    `;
}

function formatDurationHoursAndDays(hours) {
    const safeHours = Number(hours);
    if (!Number.isFinite(safeHours) || safeHours <= 0) {
        return "-";
    }
    const days = safeHours / 24;
    return `${formatNumber(safeHours, 2)} h (${formatNumber(days, 2)} dias)`;
}

function formatTleAgeHuman(ageDays) {
    if (!Number.isFinite(ageDays)) return "edad desconocida";
    if (ageDays < (1 / 24)) {
        const minutes = Math.max(1, Math.floor(ageDays * 24 * 60));
        return `${minutes} min`;
    }
    if (ageDays < 1) {
        const hours = Math.max(1, Math.floor(ageDays * 24));
        return `${hours} h`;
    }
    return `${Math.floor(ageDays)} dias`;
}

function formatUtcDateTime(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value)) {
        return "-";
    }
    try {
        return new Date(value).toISOString();
    } catch {
        return "-";
    }
}

function buildGroundStationInfoText(telemetry, sectionOpenState = {}) {
    const station = telemetry?.station || {};
    const realtime = telemetry?.realtime || {};
    const nextPasses = Array.isArray(telemetry?.next_passes) ? telemetry.next_passes : [];

    const stationRows = [
        row("Nombre", station.name || telemetry?.id || "-"),
        row("Latitud", formatNumber(station.latitude_deg, 6), " deg"),
        row("Longitud", formatNumber(station.longitude_deg, 6), " deg"),
        row("Altitud", formatNumber(station.altitude_m, 1), " m"),
        row("Mascara elev.", formatNumber(station.min_elevation_deg, 1), " deg")
    ].join("");

    const realtimeRows = [
        row("Satelites visibles", formatNumber(realtime.visible_satellites, 0)),
        row("Satelites activos", formatNumber(realtime.active_satellites, 0)),
        row("Mejor elevacion", formatNumber(realtime.best_elevation_deg, 1), " deg"),
        row("Mejor rango", formatNumber(realtime.best_range_km, 1), " km"),
        row("Mejor enlace", Number.isFinite(realtime.best_link_dbm) ? formatNumber(realtime.best_link_dbm, 1) : "-", " dBm")
    ].join("");

    const radioRows = [
        row("Frecuencia", formatNumber(station.frequency_mhz, 2), " MHz"),
        row("Potencia TX", formatNumber(station.tx_power_dbm, 1), " dBm"),
        row("Ganancia TX", formatNumber(station.tx_gain_dbi, 1), " dBi"),
        row("Ganancia RX", formatNumber(station.rx_gain_dbi, 1), " dBi")
    ].join("");

    const passesRows = nextPasses.length
        ? nextPasses.slice(0, 6).map((pass, index) => {
            const title = pass?.satellite || `SAT-${index + 1}`;
            const aos = pass?.aos || "-";
            const los = pass?.los || "-";
            const maxEl = Number.isFinite(pass?.max_elevation_deg) ? `${formatNumber(pass.max_elevation_deg, 1)} deg` : "-";
            const aosText = escapeHtml(String(aos).replace("T", " ").replace("+00:00", " UTC"));
            const losText = escapeHtml(String(los).replace("T", " ").replace("+00:00", " UTC"));
            return `
                <article class="object-pass-card" title="Ventana de visibilidad estimada para ${escapeHtml(title)}">
                    <div class="object-pass-card-header">
                        <span class="object-pass-satellite">${escapeHtml(title)}</span>
                        <span class="object-pass-maxel">MAX ${escapeHtml(maxEl)}</span>
                    </div>
                    <div class="object-pass-row"><strong>AOS</strong><span>${aosText}</span></div>
                    <div class="object-pass-row"><strong>LOS</strong><span>${losText}</span></div>
                </article>
            `;
        }).join("")
        : row("Pases", "Sin datos (se estan calculando o no hay visibilidad)");

    return `
        <div class="object-info-title">${escapeHtml(telemetry?.id || station.name || "Estacion terrestre")}</div>
        ${section("station", "Estacion", stationRows, sectionOpenState.station !== false)}
        ${section("realtime", "Tiempo real", realtimeRows, sectionOpenState.realtime !== false)}
        ${section("radio", "Radio", radioRows, sectionOpenState.radio !== false)}
        ${section("passes", "Tabla de pases (AOS/LOS)", passesRows, sectionOpenState.passes !== false)}
    `;
}

function buildInfoText(telemetry, orbitInfo = null, tleSummary = null, sectionOpenState = {}, oemDomainActive = false) {
    if (!telemetry) {
        return "<div class=\"object-info-empty\">Selecciona un objeto para ver telemetria en tiempo real.</div>";
    }

    const sourceFormatForKind = String(telemetry.source_format || "TLE").toUpperCase();
    if (sourceFormatForKind === "GROUND_STATION") {
        return buildGroundStationInfoText(telemetry, sectionOpenState);
    }

    const g = telemetry.geo || {};
    const v = telemetry.velocity;
    const sourceFormat = String(telemetry.source_format || "TLE").toUpperCase();
    const sourceOrigin = String(telemetry.source_origin || "CATALOG").toUpperCase();
    const oem = telemetry.oem || null;

    const geoRows = [
        row("Latitud", formatNumber(g.latitude_deg, 6), " deg"),
        row("Longitud", formatNumber(g.longitude_deg, 6), " deg"),
        row("Altitud", formatNumber(g.altitude_m, 2), " m")
    ].join("");

    const kinematicsRows = [
        row("Velocidad X", formatNumber(v.x, 3), " m/s"),
        row("Velocidad Y", formatNumber(v.y, 3), " m/s"),
        row("Velocidad Z", formatNumber(v.z, 3), " m/s"),
        row("Modulo velocidad", formatNumber(telemetry.speed_m_s, 3), " m/s"),
        row("Velocidad", formatNumber(telemetry.speed_km_h, 2), " km/h")
    ].join("");

    const statusRows = [
        row("Distancia a camara", formatNumber(telemetry.distance_to_camera_m, 2), " m"),
        row("Puntos de estela", formatNumber(telemetry.trail_points, 0)),
        row("Edad telemetria", formatNumber(telemetry.telemetry_age_ms, 0), " ms"),
        row("Fuente orbital", sourceFormat),
        row("Origen", sourceOrigin),
        row("Propagacion", sourceFormat === "OEM" ? "OEM Ephemeris" : "SGP4"),
        row("Tipo orbita", orbitInfo?.label || "Desconocida")
    ].join("");

    let orbitRows = "";
    if (sourceFormat === "OEM") {
        orbitRows = [
            row("Tipo de fuente", "OEM"),
            row("Inicio OEM", formatUtcDateTime(oem?.start_time_ms)),
            row("Fin OEM", formatUtcDateTime(oem?.end_time_ms)),
            row("Muestras OEM", formatNumber(oem?.samples, 0)),
            row("Ref. frame", oem?.ref_frame || "-"),
            row("Time system", oem?.time_system || "-"),
            row("Estado temporal", oem?.is_in_time_window === true ? "En ventana" : "Sin datos en este instante")
        ].join("");
    } else if (sourceFormat === "OMM") {
        orbitRows = [
            row("Tipo de fuente", "OMM"),
            ...(oemDomainActive ? [] : [row("Propagacion futura", formatDurationHoursAndDays(telemetry.propagation_future_hours))]),
            row("Tipo de orbita", orbitInfo?.label || "Desconocida"),
            row("Altitud estimada", Number.isFinite(orbitInfo?.altitudeKm) ? formatNumber(orbitInfo.altitudeKm, 1) : "-", " km"),
            row("Ventana recomendada", orbitInfo?.recommendedWindow || "Sin referencia"),
            ...(oemDomainActive ? [row("Dominio temporal", "OEM activo (rango forzado)")] : [])
        ].join("");
    } else {
        const tleAgeDays = tleAgeDaysFromSummary(tleSummary);
        orbitRows = [
            row("Tipo de fuente", "TLE"),
            ...(oemDomainActive ? [] : [
                row("Propagacion futura", formatDurationHoursAndDays(telemetry.propagation_future_hours)),
                row("Propagacion pasada", formatDurationHoursAndDays(telemetry.propagation_past_hours)),
                row("Pasado configurado", formatNumber(telemetry.propagation_past_seconds, 1), " s")
            ]),
            row("Tipo de orbita", orbitInfo?.label || "Desconocida"),
            row("Altitud estimada", Number.isFinite(orbitInfo?.altitudeKm) ? formatNumber(orbitInfo.altitudeKm, 1) : "-", " km"),
            row("Edad TLE", formatTleAgeHuman(tleAgeDays)),
            row("Ventana recomendada", orbitInfo?.recommendedWindow || "Sin referencia"),
            ...(oemDomainActive ? [row("Dominio temporal", "OEM activo (rango forzado)")] : [])
        ].join("");
    }

    const orbitTag = orbitInfo ? buildOrbitTypeTagHtml(orbitInfo) : "";

    return `
        <div class="object-info-title">${orbitTag}${escapeHtml(telemetry.id)}</div>
        ${section("geografica", "Geografica", geoRows, sectionOpenState.geografica !== false)}
        ${section("cinematica", "Cinematica", kinematicsRows, sectionOpenState.cinematica !== false)}
        ${section("orbita", "Orbita", orbitRows, sectionOpenState.orbita !== false)}
        ${section("estado", "Estado", statusRows, sectionOpenState.estado !== false)}
    `;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function parseTleSummary(tle) {
    if (!tle?.line1 || !tle?.line2) {
        return null;
    }

    const line1 = tle.line1;
    const line2 = tle.line2;

    const epoch = line1.slice(18, 32).trim();
    const meanMotionDot = line1.slice(33, 43).trim();
    const bstar = line1.slice(53, 61).trim();

    const inclinationDeg = line2.slice(8, 16).trim();
    const raanDeg = line2.slice(17, 25).trim();
    const eccentricityRaw = line2.slice(26, 33).trim();
    const argPerigeeDeg = line2.slice(34, 42).trim();
    const meanAnomalyDeg = line2.slice(43, 51).trim();
    const meanMotionRevDay = line2.slice(52, 63).trim();

    return {
        epoch,
        meanMotionDot,
        bstar,
        inclinationDeg,
        raanDeg,
        eccentricity: eccentricityRaw ? `0.${eccentricityRaw}` : "-",
        argPerigeeDeg,
        meanAnomalyDeg,
        meanMotionRevDay,
        line1,
        line2
    };
}

// Convertir epoch TLE (YYDDD.dddddd) a Date UTC
function tleEpochToDate(epochStr) {
    if (!epochStr) return null;
    // Normalizar y asegurar formato
    const s = String(epochStr).trim();
    if (!/^[0-9]{5}(.+)?/.test(s)) {
        // intentar parsear con partes
    }
    const yy = Number(s.slice(0, 2));
    const doy = Number(s.slice(2));
    if (!Number.isFinite(yy) || !Number.isFinite(doy)) return null;
    const year = yy >= 57 ? 1900 + yy : 2000 + yy;
    const dayIndex = Math.floor(doy) - 1;
    const fraction = doy - Math.floor(doy);
    const ms = Math.round(fraction * 24 * 3600 * 1000);
    const date = new Date(Date.UTC(year, 0, 1));
    date.setUTCDate(date.getUTCDate() + dayIndex);
    // añadir fraccion del dia
    date.setTime(date.getTime() + ms);
    return date;
}

const EARTH_RADIUS_KM = 6378.137;
const EARTH_MU_KM3_S2 = 398600.4418;

const ORBIT_KIND = {
    LEO: "leo",
    MEO: "meo",
    GEO: "geo",
    HEO: "heo",
    UNKNOWN: "unknown"
};

const MISSION_RULES = [
    { value: "starlink", label: "Starlink", test: /\bstarlink\b/i },
    { value: "sentinel", label: "Sentinel", test: /\bsentinel\b/i },
    { value: "oneweb", label: "OneWeb", test: /\boneweb\b/i },
    { value: "planet", label: "Planet", test: /\bplanet\b/i },
    { value: "gnss", label: "GNSS", test: /\b(gps|galileo|glonass|beidou|navstar|qzss|irnss|navic)\b/i },
    { value: "weather", label: "Weather", test: /\b(weather|goes|noaa|meteo|metop|himawari|fy-|fengyun)\b/i },
    { value: "communications", label: "Communications", test: /\b(intelsat|iridium|orbcomm|globalstar|ses|viasat|echostar)\b/i },
    { value: "stations", label: "Stations", test: /\b(iss|tiangong|css|station)\b/i },
    { value: "military", label: "Military", test: /\b(nrol|yaogan|military|defense|usa )\b/i },
    { value: "science", label: "Science", test: /\b(hubble|jwst|fermi|swift|gaia|tess|science)\b/i },
    { value: "earth-observation", label: "Earth Observation", test: /\b(landsat|resource|dmc|radarsat|spot|pleiades)\b/i }
];

const ORBIT_FILTER_ORDER = [ORBIT_KIND.LEO, ORBIT_KIND.MEO, ORBIT_KIND.GEO, ORBIT_KIND.HEO, ORBIT_KIND.UNKNOWN];
const MISSION_FILTER_ORDER = [...MISSION_RULES.map((rule) => rule.value), "other"];

function orbitTagCode(kind) {
    switch (kind) {
    case ORBIT_KIND.LEO: return "LEO";
    case ORBIT_KIND.MEO: return "MEO";
    case ORBIT_KIND.GEO: return "GEO";
    case ORBIT_KIND.HEO: return "HEO";
    default: return "UNKNOWN";
    }
}

function buildOrbitTypeTagHtml(orbitInfo) {
    if (!orbitInfo) return "";
    const code = orbitTagCode(orbitInfo.kind);
    return `<span class="orbit-type-tag orbit-type-${escapeHtml(orbitInfo.kind)}" title="${escapeHtml(orbitInfo.label)}">[${escapeHtml(code)}]</span> `;
}

function createOrbitTypeTagElement(orbitInfo) {
    if (!orbitInfo) return null;
    const code = orbitTagCode(orbitInfo.kind);
    const tag = document.createElement("span");
    tag.className = `orbit-type-tag orbit-type-${orbitInfo.kind}`;
    tag.title = orbitInfo.label;
    tag.textContent = `[${code}]`;
    return tag;
}

function estimateAltitudeKmFromMeanMotion(meanMotionRevDay) {
    const revDay = Number(meanMotionRevDay);
    if (!Number.isFinite(revDay) || revDay <= 0) return null;
    const nRadSec = revDay * (2 * Math.PI) / 86400;
    const semiMajorAxisKm = Math.cbrt(EARTH_MU_KM3_S2 / (nRadSec * nRadSec));
    const altitudeKm = semiMajorAxisKm - EARTH_RADIUS_KM;
    return Number.isFinite(altitudeKm) ? altitudeKm : null;
}

function classifyOrbitByAltitudeKm(altitudeKm) {
    if (!Number.isFinite(altitudeKm)) return ORBIT_KIND.UNKNOWN;
    if (altitudeKm < 2000) return ORBIT_KIND.LEO;
    if (altitudeKm < 35786) return ORBIT_KIND.MEO;
    if (altitudeKm >= 35000 && altitudeKm <= 36550) return ORBIT_KIND.GEO;
    if (altitudeKm > 35786) return ORBIT_KIND.HEO;
    return ORBIT_KIND.UNKNOWN;
}

function classifyOrbitByName(satelliteId) {
    const s = String(satelliteId || "").toLowerCase();
    if (!s) return ORBIT_KIND.UNKNOWN;
    return ORBIT_KIND.UNKNOWN;
}

function inferMissionInfo(satelliteId) {
    const normalized = String(satelliteId || "").trim();
    for (const rule of MISSION_RULES) {
        if (rule.test.test(normalized)) {
            return { value: rule.value, label: rule.label };
        }
    }
    return { value: "other", label: "Other" };
}

function getOrbitRecommendation(orbitKind) {
    switch (orbitKind) {
    case ORBIT_KIND.LEO:
        return { label: "LEO - Low Earth Orbit", recommendedWindow: "1-3 dias", recommendedMaxDays: 3 };
    case ORBIT_KIND.MEO:
        return { label: "MEO - Medium Earth Orbit", recommendedWindow: "1-2 semanas", recommendedMaxDays: 14 };
    case ORBIT_KIND.GEO:
        return { label: "GEO - Geostationary Orbit", recommendedWindow: "2-4 semanas", recommendedMaxDays: 28 };
    case ORBIT_KIND.HEO:
        return { label: "HEO - High Earth Orbit", recommendedWindow: "2-4 semanas", recommendedMaxDays: 28 };
    default:
        return { label: "Desconocida", recommendedWindow: "Sin referencia", recommendedMaxDays: null };
    }
}

function getOrbitInfoFromTleSummary(tleSummary, satelliteId = "") {
    const altitudeKm = estimateAltitudeKmFromMeanMotion(tleSummary?.meanMotionRevDay);
    let kind = classifyOrbitByAltitudeKm(altitudeKm);
    if (kind === ORBIT_KIND.UNKNOWN) {
        kind = classifyOrbitByName(satelliteId);
    }
    const recommendation = getOrbitRecommendation(kind);
    const veryLowOverride = kind === ORBIT_KIND.LEO && Number.isFinite(altitudeKm) && altitudeKm < 400;
    return {
        kind,
        altitudeKm,
        label: recommendation.label,
        recommendedWindow: veryLowOverride ? "< 24 horas" : recommendation.recommendedWindow,
        recommendedMaxDays: veryLowOverride ? 1 : recommendation.recommendedMaxDays
    };
}

function getOrbitInfoFromTelemetry(telemetry, satelliteId = "") {
    const altitudeKmRaw = Number(telemetry?.geo?.altitude_m);
    const altitudeKm = Number.isFinite(altitudeKmRaw) ? altitudeKmRaw / 1000 : null;
    let kind = ORBIT_KIND.UNKNOWN;

    if (Number.isFinite(altitudeKm)) {
        if (altitudeKm < 2000) kind = ORBIT_KIND.LEO;
        else if (altitudeKm < 30000) kind = ORBIT_KIND.MEO;
        else if (altitudeKm < 42000) kind = ORBIT_KIND.GEO;
        else kind = ORBIT_KIND.HEO;
    }

    const recommendation = getOrbitRecommendation(kind);
    const veryLowOverride = Number.isFinite(altitudeKm) && altitudeKm < 300;
    const mission = inferMissionInfo(satelliteId);

    return {
        kind,
        label: recommendation.label,
        altitudeKm,
        recommendedWindow: veryLowOverride ? "< 24 horas" : recommendation.recommendedWindow,
        recommendedMaxDays: veryLowOverride ? 1 : recommendation.recommendedMaxDays,
        mission
    };
}

function buildTleFreshnessMessage(orbitInfo, ageDays) {
    const ageText = formatTleAgeHuman(ageDays);
    const orbitLabel = orbitInfo?.label || "orbita desconocida";
    const rec = orbitInfo?.recommendedWindow || "sin referencia";
    return `Edad del TLE: ${ageText}. Recomendado para ${orbitLabel}: ${rec}.`;
}

function tleAgeDaysFromSummary(tleSummary) {
    if (!tleSummary || !tleSummary.epoch) return null;
    const d = tleEpochToDate(tleSummary.epoch);
    if (!d) return null;
    return (Date.now() - d.getTime()) / (24 * 3600 * 1000);
}

function checkTleOldAdaptive(tleSummary, orbitInfo) {
    const age = tleAgeDaysFromSummary(tleSummary);
    const maxDays = orbitInfo?.recommendedMaxDays;
    if (age === null || !Number.isFinite(maxDays)) {
        return { isOld: false, days: null };
    }
    return { isOld: age > maxDays, days: Math.floor(age) };
}

function buildTleExplanationHtml(satelliteId, tleSummary) {
    if (!tleSummary) {
        return `<div class="tle-info-empty">No hay TLE disponible para <strong>${escapeHtml(satelliteId)}</strong>.</div>`;
    }

    const orbitInfo = getOrbitInfoFromTleSummary(tleSummary, satelliteId);
    const tleAgeDays = tleAgeDaysFromSummary(tleSummary);
    const freshnessText = buildTleFreshnessMessage(orbitInfo, tleAgeDays);

    return `
        <div class="tle-info-title">${buildOrbitTypeTagHtml(orbitInfo)}${escapeHtml(satelliteId)}</div>
        <section class="tle-info-section">
            <h4>Lineas TLE</h4>
            <pre>${escapeHtml(tleSummary.line1)}\n${escapeHtml(tleSummary.line2)}</pre>
        </section>
        <section class="tle-info-section">
            <h4>Parametros Orbitales</h4>
            <div class="tle-info-grid">
                <div><span>Epoca</span><strong>${escapeHtml(tleSummary.epoch || "-")}</strong></div>
                <div><span>Tipo orbita</span><strong>${escapeHtml(orbitInfo.label)}</strong></div>
                <div><span>Altitud estimada</span><strong>${Number.isFinite(orbitInfo.altitudeKm) ? `${escapeHtml(formatNumber(orbitInfo.altitudeKm, 1))} km` : "-"}</strong></div>
                <div><span>Inclinacion</span><strong>${escapeHtml(tleSummary.inclinationDeg || "-")} deg</strong></div>
                <div><span>RAAN</span><strong>${escapeHtml(tleSummary.raanDeg || "-")} deg</strong></div>
                <div><span>Excentricidad</span><strong>${escapeHtml(tleSummary.eccentricity || "-")}</strong></div>
                <div><span>Arg. Perigeo</span><strong>${escapeHtml(tleSummary.argPerigeeDeg || "-")} deg</strong></div>
                <div><span>Anomalia Media</span><strong>${escapeHtml(tleSummary.meanAnomalyDeg || "-")} deg</strong></div>
                <div><span>Movimiento Medio</span><strong>${escapeHtml(tleSummary.meanMotionRevDay || "-")} rev/dia</strong></div>
                <div><span>Derivada Mov. Medio</span><strong>${escapeHtml(tleSummary.meanMotionDot || "-")}</strong></div>
                <div><span>BSTAR</span><strong>${escapeHtml(tleSummary.bstar || "-")}</strong></div>
            </div>
        </section>
        <section class="tle-info-section">
            <h4>Vigencia recomendada</h4>
            <p class="tle-info-paragraph">${escapeHtml(freshnessText)}</p>
        </section>
        <section class="tle-info-section">
            <h4>Interpretacion rapida</h4>
            <ul>
                <li><strong>Inclinacion</strong>: angulo del plano orbital.</li>
                <li><strong>RAAN</strong>: orientacion del plano orbital.</li>
                <li><strong>Excentricidad</strong>: forma de la orbita.</li>
                <li><strong>Anomalia media</strong>: posicion del satelite en la epoca.</li>
                <li><strong>Movimiento medio</strong>: vueltas por dia.</li>
            </ul>
        </section>
    `;
}

function buildOemExplanationHtml(satelliteId, telemetry, sourceMeta = null) {
    const oem = telemetry?.oem || {};
    const sourceOrigin = String(sourceMeta?.sourceOrigin || telemetry?.source_origin || "CUSTOM").toUpperCase();

    return `
        <div class="tle-info-title">${escapeHtml(satelliteId)}</div>
        <section class="tle-info-section">
            <h4>Formato orbital</h4>
            <div class="tle-info-grid">
                <div><span>Fuente</span><strong>OEM</strong></div>
                <div><span>Origen</span><strong>${escapeHtml(sourceOrigin)}</strong></div>
                <div><span>Inicio</span><strong>${escapeHtml(formatUtcDateTime(oem.start_time_ms))}</strong></div>
                <div><span>Fin</span><strong>${escapeHtml(formatUtcDateTime(oem.end_time_ms))}</strong></div>
                <div><span>Muestras</span><strong>${escapeHtml(formatNumber(oem.samples, 0))}</strong></div>
                <div><span>Frame</span><strong>${escapeHtml(oem.ref_frame || "-")}</strong></div>
                <div><span>Time system</span><strong>${escapeHtml(oem.time_system || "-")}</strong></div>
                <div><span>Estado temporal</span><strong>${oem.is_in_time_window === true ? "En ventana" : "Fuera de ventana"}</strong></div>
            </div>
        </section>
        <section class="tle-info-section">
            <h4>Interpretacion</h4>
            <p class="tle-info-paragraph">Este objeto usa efemérides OEM del fichero importado, no una propagación TLE/SGP4.</p>
            <p class="tle-info-paragraph">Cuando la simulación cae fuera del intervalo OEM, el objeto no se representa.</p>
        </section>
    `;
}

function buildOmmExplanationHtml(satelliteId, telemetry, sourceMeta = null, tleSummary = null) {
    const sourceOrigin = String(sourceMeta?.sourceOrigin || telemetry?.source_origin || "CATALOG").toUpperCase();
    const orbitInfo = getOrbitInfoFromTleSummary(tleSummary, satelliteId);

    return `
        <div class="tle-info-title">${buildOrbitTypeTagHtml(orbitInfo)}${escapeHtml(satelliteId)}</div>
        <section class="tle-info-section">
            <h4>Formato orbital</h4>
            <div class="tle-info-grid">
                <div><span>Fuente</span><strong>OMM</strong></div>
                <div><span>Origen</span><strong>${escapeHtml(sourceOrigin)}</strong></div>
                <div><span>Tipo orbita</span><strong>${escapeHtml(orbitInfo?.label || "Desconocida")}</strong></div>
                <div><span>Altitud estimada</span><strong>${Number.isFinite(orbitInfo?.altitudeKm) ? `${escapeHtml(formatNumber(orbitInfo.altitudeKm, 1))} km` : "-"}</strong></div>
            </div>
        </section>
        <section class="tle-info-section">
            <h4>Interpretacion</h4>
            <p class="tle-info-paragraph">Este objeto está marcado como OMM. La explicación prioriza metadatos de fuente y no asume TLE crudo.</p>
        </section>
    `;
}

function buildSatelliteDetailsHtml(satelliteId, details, orbitInfo = null) {
    if (!details) {
        return `
            <div class="tle-info-title">${buildOrbitTypeTagHtml(orbitInfo)}${escapeHtml(satelliteId)}</div>
            <div class="tle-info-empty">No se encontro informacion externa fiable para este satelite.</div>
        `;
    }

    return `
        <div class="tle-info-title">${buildOrbitTypeTagHtml(orbitInfo)}${escapeHtml(details.title || satelliteId)}</div>
        <section class="tle-info-section">
            <h4>Resumen</h4>
            <p class="tle-info-paragraph">${escapeHtml(details.summary || "-")}</p>
        </section>
        <section class="tle-info-section">
            <h4>Clasificacion</h4>
            <p class="tle-info-paragraph">${escapeHtml(orbitInfo?.label || "Desconocida")}</p>
        </section>
        ${details.orbitalHtml || ""}
        <section class="tle-info-section">
            <h4>Fuente</h4>
            <p class="tle-info-paragraph">${escapeHtml(details.source || "Wikipedia")}</p>
            ${details.url ? `<a class="tle-info-link" href="${escapeHtml(details.url)}" target="_blank" rel="noopener noreferrer">Abrir referencia</a>` : ""}
        </section>
    `;
}

function getSatelliteNameCandidates(satelliteId) {
    const normalized = (satelliteId || "").trim();
    if (!normalized) {
        return [];
    }

    const base = normalized.replace(/\s*\([^)]*\)\s*/g, "").trim();
    const candidates = [normalized, base].filter(Boolean);

    if (/\bISS\b|ZARYA/i.test(normalized)) {
        candidates.push("ISS (ZARYA)", "International Space Station");
    }
    if (/STARLINK/i.test(normalized)) {
        candidates.push("STARLINK");
    }
    if (/SENTINEL/i.test(normalized)) {
        candidates.push("SENTINEL");
    }

    return [...new Set(candidates)];
}

function buildCelestrakDetailsFromRecord(satelliteId, record) {
    if (!record) {
        return null;
    }

    const noradId = record.NORAD_CAT_ID || record.CATNR || "";
    const objectName = record.OBJECT_NAME || satelliteId;
    const objectId = record.OBJECT_ID || "-";
    const epoch = record.EPOCH || "-";
    const inclination = record.INCLINATION ?? "-";
    const eccentricity = record.ECCENTRICITY ?? "-";
    const meanMotion = record.MEAN_MOTION ?? "-";

    const orbitalHtml = `
        <section class="tle-info-section">
            <h4>Orbita (CelesTrak GP)</h4>
            <div class="tle-info-grid">
                <div><span>NORAD</span><strong>${escapeHtml(String(noradId || "-"))}</strong></div>
                <div><span>OBJECT_ID</span><strong>${escapeHtml(String(objectId))}</strong></div>
                <div><span>Epoch</span><strong>${escapeHtml(String(epoch))}</strong></div>
                <div><span>Inclinacion</span><strong>${escapeHtml(String(inclination))}</strong></div>
                <div><span>Excentricidad</span><strong>${escapeHtml(String(eccentricity))}</strong></div>
                <div><span>Mean motion</span><strong>${escapeHtml(String(meanMotion))}</strong></div>
            </div>
        </section>
    `;

    return {
        title: objectName,
        summary: `Registro orbital obtenido de CelesTrak para ${objectName}.`,
        source: "CelesTrak",
        url: noradId ? `https://celestrak.org/satcat/records.php?CATNR=${encodeURIComponent(String(noradId))}` : "https://celestrak.org",
        orbitalHtml
    };
}

async function fetchCelestrakDetails(satelliteId) {
    const candidates = getSatelliteNameCandidates(satelliteId);
    for (const candidate of candidates) {
        try {
            const url = `https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(candidate)}&FORMAT=JSON`;
            const response = await fetch(url, { headers: { Accept: "application/json" } });
            if (!response.ok) {
                continue;
            }

            const data = await response.json();
            const first = Array.isArray(data) ? data[0] : null;
            if (!first) {
                continue;
            }

            return buildCelestrakDetailsFromRecord(satelliteId, first);
        } catch {
            // seguir probando candidatos
        }
    }

    return null;
}

async function fetchWikipediaDetails(satelliteId) {
    const candidates = getSatelliteNameCandidates(satelliteId);
    for (const candidate of candidates) {
        try {
            const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate)}`;
            const response = await fetch(url, { headers: { Accept: "application/json" } });
            if (!response.ok) {
                continue;
            }

            const data = await response.json();
            if (!data?.extract) {
                continue;
            }

            return {
                title: data.title || candidate,
                summary: data.extract,
                source: "Wikipedia",
                url: data.content_urls?.desktop?.page || null
            };
        } catch {
            // fallback con siguiente candidato
        }
    }

    return null;
}

export function setupObjectSidebar({
    getCatalogIds,
    fetchCatalogPage,
    getLayerIds,
    getObjectTelemetry,
    getObjectVisibility,
    onToggleObjectVisibility,
    getObjectLayerActive,
    onToggleObjectLayer,
    getMaxActiveLayers,
    getAvailableLayerSlots,
    onRemoveAllLayers,
    onShowAllObjects,
    onHideAllObjects,
    onFocusObject,
    onSelectObject,
    onOpenVisualizationOptions,
    onToggleGroundTrack,
    getGroundTrackVisible,
    onRequestAddSatellite,
    onRequestCreateGroundStation,
    onRequestUpdateGroundStation,
    onRequestToggleGroundStationHeatMap,
    onRequestDuplicateLayer,
    onRequestRenameLayer,
    getLayerDisplayName,
    getLayerType,
    getGroundStationParams,
    isCatalogReady,
    getObjectTle,
    getObjectTleAsync,
    getCatalogEntryMeta,
    onRefreshCatalog,
    onImportOemEphemeris,
    getLoadedOemTimeBounds,
    onAlignToOemTimeDomain,
    getUiText,
    containerElement = null,
    infoContainerElement = null
}) {
    // getUiText es una función que devuelve el traductor actual: () => (key) => string
    // Resolvemos el traductor en cada llamada para reaccionar a cambios de idioma.
    const uiTextProvider = typeof getUiText === "function" ? getUiText : () => (key) => key;
    const uiText = (key) => {
        const translator = uiTextProvider();
        return typeof translator === "function" ? translator(key) : key;
    };
    let selectedId = null;
    let layerFilterText = "";
    let layerSearchOptions = { matchCase: false, wholeWord: false, regex: false };
    let globalLayersVisible = true;
    const selectedCatalogIds = new Set();
    const catalogFilterState = {
        name: "",
        orbitKind: "",
        mission: "",
        sourceFormat: "",
        decayOnly: false
    };

    const CATALOG_PAGE_SIZE = 200;
    const BULK_PROCESS_CHUNK = 60;

    let catalogRenderToken = 0;
    let catalogQueryToken = 0;
    let catalogSearchDebounce = null;
    let catalogBusy = false;
    let catalogRefreshBusy = false;
    let catalogRefreshTimer = null;
    let catalogAnchorIndex = null;
    let catalogWaitInterval = null;
    let contextTargetId = null;
    let editingGroundStationId = null;
    let exportSourceFormat = "TLE";
    let lastRenderedCatalogIds = [];
    let catalogServerTotal = 0;
    let catalogOffset = 0;
    let catalogCurrentPage = 1;
    let catalogTotalPages = 1;
    let catalogHasMore = false;
    let catalogLoadingPage = false;
    // Project ownership will provide persistence later; UI grouping is session-only.
    const layerTree = createLayerTree(null);
    let globalFileDragDepth = 0;
    const catalogIndexById = new Map();
    const catalogMetaCache = new Map();
    const infoSectionOpenState = {
        geografica: true,
        cinematica: true,
        orbita: true,
        estado: true,
        station: true,
        realtime: true,
        radio: true,
        passes: true
    };

    function normalizeImportFormat(rawFormat) {
        const raw = String(rawFormat || "").trim().toUpperCase();
        if (raw === "OMM_JSON" || raw === "OMM_XML" || raw === "OMM") {
            return "OMM";
        }
        if (raw === "OEM") {
            return "OEM";
        }
        return "TLE";
    }

    function getSourceFormatForId(id) {
        const meta = getCatalogEntryMeta?.(id);
        return String(meta?.sourceFormat || "TLE").trim().toUpperCase();
    }

    function getActiveFormatsSummary() {
        const activeIds = Array.isArray(getLayerIds?.()) ? getLayerIds() : [];
        let oem = 0;
        let nonOem = 0;
        for (const id of activeIds) {
            if (getSourceFormatForId(id) === "OEM") {
                oem += 1;
            } else {
                nonOem += 1;
            }
        }
        return { activeIds, oem, nonOem };
    }

    async function resolveTleSummaryForSatellite(satelliteId) {
        const tle = await resolveTle(satelliteId);
        return parseTleSummary(tle);
    }

    function evaluateTleCompatibilityWithOemBounds(tleSummary, bounds) {
        if (!bounds || !tleSummary?.epoch) {
            return { compatible: null, reason: "missing-data" };
        }

        const epochDate = tleEpochToDate(tleSummary.epoch);
        if (!epochDate || Number.isNaN(epochDate.getTime())) {
            return { compatible: null, reason: "invalid-epoch" };
        }

        const orbitInfo = getOrbitInfoFromTleSummary(tleSummary);
        const maxDays = Number.isFinite(orbitInfo?.recommendedMaxDays)
            ? Number(orbitInfo.recommendedMaxDays)
            : 14;

        const startMs = Number(bounds.startTimeMs);
        const endMs = Number(bounds.endTimeMs);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
            return { compatible: null, reason: "invalid-bounds" };
        }

        const epochMs = epochDate.getTime();
        const deltaStartDays = Math.abs(epochMs - startMs) / (24 * 3600 * 1000);
        const deltaEndDays = Math.abs(epochMs - endMs) / (24 * 3600 * 1000);
        const worstDeltaDays = Math.max(deltaStartDays, deltaEndDays);

        return {
            compatible: worstDeltaDays <= maxDays,
            worstDeltaDays,
            maxDays,
            orbitLabel: orbitInfo?.label || "Desconocida"
        };
    }

    async function warnTemporalIncompatibilitiesWithOemRange(candidateIds, bounds) {
        if (!bounds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
            return;
        }

        const unique = [...new Set(candidateIds.map((id) => String(id || "").trim()).filter(Boolean))];
        const incompatible = [];
        const unresolved = [];

        for (const id of unique.slice(0, 30)) {
            if (getSourceFormatForId(id) === "OEM") {
                continue;
            }

            const tleSummary = await resolveTleSummaryForSatellite(id);
            const check = evaluateTleCompatibilityWithOemBounds(tleSummary, bounds);
            if (check.compatible === false) {
                incompatible.push(`${id} (${formatNumber(check.worstDeltaDays, 1)}d > ${formatNumber(check.maxDays, 1)}d)`);
            } else if (check.compatible === null) {
                unresolved.push(id);
            }
        }

        if (incompatible.length > 0) {
            const sample = incompatible.slice(0, 5).join(", ");
            const suffix = incompatible.length > 5 ? ` +${incompatible.length - 5} mas` : "";
            showErrorPopup(`Aviso temporal: hay TLE/OMM fuera de ventana recomendable para el dominio OEM. ${sample}${suffix}.`);
        }

        if (unresolved.length > 0) {
            const sample = unresolved.slice(0, 5).join(", ");
            const suffix = unresolved.length > 5 ? ` +${unresolved.length - 5} mas` : "";
            showErrorPopup(`Aviso temporal: no se pudo validar epoca orbital de ${sample}${suffix} frente al rango OEM.`);
        }
    }

    function clearCatalogMetaCache() {
        catalogMetaCache.clear();
    }

    function getCatalogMeta(id) {
        const tle = getObjectTle ? getObjectTle(id) : null;
        const hasTle = Boolean(tle?.line1 && tle?.line2);
        const cached = catalogMetaCache.get(id);

        if (cached && (cached.hasTle || !hasTle)) {
            return cached;
        }

        const tleSummary = parseTleSummary(tle);
        const orbitInfo = getOrbitInfoFromTleSummary(tleSummary, id);
        const tleAgeDays = tleAgeDaysFromSummary(tleSummary);
        const tleAgeCheck = checkTleOldAdaptive(tleSummary, orbitInfo);
        const missionInfo = inferMissionInfo(id);
        const meta = {
            tleSummary,
            orbitInfo,
            missionInfo,
            hasTle,
            tleAgeDays,
            tleAgeWarning: Boolean(tleAgeCheck?.isOld)
        };
        catalogMetaCache.set(id, meta);
        return meta;
    }

    function orbitFilterLabel(kind) {
        switch (kind) {
        case ORBIT_KIND.LEO: return "LEO";
        case ORBIT_KIND.MEO: return "MEO";
        case ORBIT_KIND.GEO: return "GEO";
        case ORBIT_KIND.HEO: return "HEO";
        default: return "Unknown";
        }
    }

    function missionFilterLabel(value) {
        const rule = MISSION_RULES.find((item) => item.value === value);
        return rule?.label || "Other";
    }

    const catalogRowElements = new Map();

    // Si se proporciona un contenedor, usar ese; si no, crear el aside legacy
    const useContainer = Boolean(containerElement);
    const useSeparateInfo = Boolean(infoContainerElement);
    let sidebar;
    
    if (useContainer) {
        sidebar = containerElement;
        sidebar.innerHTML = `
            <div class="object-sidebar-body-compact">
                <div id="objectList"></div>
                ${useSeparateInfo ? "" : `<div id="objectInfo">Selecciona un objeto para ver telemetria en tiempo real.</div>`}
            </div>
        `;

        // Renderizar la telemetría en un contenedor separado (otra pestaña)
        if (useSeparateInfo) {
            infoContainerElement.innerHTML = `<div id="objectInfo" class="object-info-standalone">Selecciona un objeto para ver telemetria en tiempo real.</div>`;
        }
    } else {
        sidebar = document.createElement("aside");
        sidebar.id = "objectSidebar";
        sidebar.innerHTML = `
            <div class="object-sidebar-header" id="objectSidebarHeader" role="button" tabindex="0" aria-expanded="false">
                <h3 class="object-sidebar-title">Objetos en simulacion</h3>
                <div class="object-sidebar-header-actions">
                    <button class="object-global-remove-btn" id="removeAllLayersHeaderBtn" type="button" title="Quitar todas las capas" aria-label="Quitar todas las capas">🗑</button>
                    <button class="object-global-eye-btn" id="toggleAllVisibilityBtn" type="button" title="Ocultar todas las capas" aria-label="Ocultar todas las capas">👁</button>
                    <button class="object-add-btn" id="openCatalogBtn" type="button" title="Añadir desde catalogo" aria-label="Añadir desde catalogo">+</button>
                    <button class="object-sidebar-toggle-btn" aria-hidden="true" title="Plegar panel">◂</button>
                </div>
            </div>
            <div class="object-sidebar-body">
                <input id="objectSearch" type="text" placeholder="Buscar capa activa..." />
                <div id="objectList"></div>
                <div id="objectInfo">Selecciona un objeto para ver telemetria en tiempo real.</div>
            </div>
        `;
        document.body.appendChild(sidebar);
    }

    const catalogModal = document.createElement("div");
    catalogModal.id = "catalogModal";
    catalogModal.innerHTML = `
        <div class="catalog-modal-panel" role="dialog" aria-modal="true" aria-label="Catalogo de objetos">
            <div class="catalog-modal-header">
                <h3>Catalogo</h3>
                <div class="catalog-modal-header-actions">
                    <button class="catalog-header-btn" id="catalogImportBtn" type="button">Importar</button>
                    <button class="catalog-header-btn" id="catalogFiltersBtn" type="button">Filtros</button>
                    <button class="catalog-header-btn" id="catalogRefreshBtn" type="button">Actualizar catalogo</button>
                    <button class="catalog-header-btn" id="catalogSelectAllBtn" type="button">Seleccionar todo</button>
                    <button class="catalog-close-btn" id="catalogCloseBtn" type="button" aria-label="Cerrar catalogo" title="Cerrar">✕</button>
                </div>
            </div>
            <input id="catalogImportFileInput" type="file" accept=".tle,.txt,.json,.xml,.omm,.oem" hidden />
            <input id="catalogSearch" type="text" placeholder="Buscar en catalogo..." />
            <div class="catalog-filter-summary" id="catalogFilterSummary" hidden></div>
            <div class="catalog-refresh-status" id="catalogRefreshStatus" hidden>
                <div class="catalog-refresh-text" id="catalogRefreshText">Preparando actualizacion...</div>
                <progress id="catalogRefreshBar" max="100" value="0"></progress>
            </div>
            <div id="catalogList"></div>
            <div class="catalog-modal-actions">
                <div class="catalog-progress" id="catalogProgress" aria-live="polite"></div>
                <div class="catalog-pagination">
                    <button class="catalog-page-btn" id="catalogPrevPageBtn" type="button">Anterior</button>
                    <div class="catalog-page-info" id="catalogPageInfo" aria-live="polite">Pagina 1/1</div>
                    <button class="catalog-page-btn" id="catalogNextPageBtn" type="button">Siguiente</button>
                </div>
                <button class="catalog-action-btn" id="catalogAddSelectedBtn" type="button">Añadir seleccionadas</button>
            </div>
        </div>
    `;
    // React renders the visible catalog modal; this node remains detached as
    // a compatibility adapter for the still-migrating catalog workflow.

    const catalogFilterModal = document.createElement("div");
    catalogFilterModal.id = "catalogFilterModal";
    catalogFilterModal.innerHTML = `
        <div class="catalog-filter-panel" role="dialog" aria-modal="true" aria-label="Filtros de catalogo">
            <div class="catalog-filter-header">
                <h3>Filtros</h3>
                <button class="catalog-close-btn" id="catalogFilterCloseBtn" type="button" aria-label="Cerrar filtros" title="Cerrar">✕</button>
            </div>
            <div class="catalog-filter-grid">
                <label class="catalog-filter-field">
                    <span>Nombre</span>
                    <input id="catalogFilterName" type="text" placeholder="Filtrar por nombre..." />
                </label>
                <label class="catalog-filter-field">
                    <span>Tipo de orbita</span>
                    <select id="catalogOrbitFilter"></select>
                </label>
                <label class="catalog-filter-field">
                    <span>Tipo de mision</span>
                    <select id="catalogMissionFilter"></select>
                </label>
                <label class="catalog-filter-field">
                    <span>Formato</span>
                    <select id="catalogSourceFormatFilter"></select>
                </label>
                <label class="catalog-filter-field checkbox">
                    <span>Solo decay (perigeo bajo)</span>
                    <input id="catalogDecayOnlyFilter" type="checkbox" />
                </label>
            </div>
            <div class="catalog-filter-actions">
                <button class="catalog-header-btn" id="catalogFilterClearBtn" type="button">Limpiar filtros</button>
            </div>
        </div>
    `;
    document.body.appendChild(catalogFilterModal);

    const confirmModal = document.createElement("div");
    confirmModal.id = "sidebarConfirmModal";
    confirmModal.innerHTML = `
        <div class="sidebar-confirm-panel" role="dialog" aria-modal="true" aria-label="Confirmacion">
            <h3 id="sidebarConfirmTitle">Confirmacion</h3>
            <p id="sidebarConfirmMessage"></p>
            <div class="sidebar-confirm-actions">
                <button class="sidebar-confirm-btn secondary" id="sidebarConfirmCancelBtn" type="button">Cancelar</button>
                <button class="sidebar-confirm-btn" id="sidebarConfirmAcceptBtn" type="button">Aceptar</button>
            </div>
        </div>
    `;
    // React owns the visible confirmation dialog; this detached node is kept
    // only while the rest of the catalog modal is still migrated.

    const catalogLoadingModal = document.createElement("div");
    catalogLoadingModal.id = "catalogLoadingModal";
    catalogLoadingModal.innerHTML = `
        <div class="catalog-loading-panel" role="status" aria-live="polite" aria-label="Cargando catalogo">
            <h3>Cargando catalogo</h3>
            <p>Esperando datos del servidor...</p>
        </div>
    `;
    document.body.appendChild(catalogLoadingModal);

    const globalDropOverlay = document.createElement("div");
    globalDropOverlay.id = "globalCatalogDropOverlay";
    globalDropOverlay.innerHTML = `
        <div class="global-drop-overlay-panel">
            <h3>Soltar para importar</h3>
            <p>Se importara al catalogo y se intentara anadir a la vista.</p>
        </div>
    `;
    // React owns the visible global drop overlay.

    const contextMenu = document.createElement("div");
    contextMenu.id = "catalogContextMenu";
    contextMenu.innerHTML = `
        <button class="catalog-context-action" id="contextRenameBtn" type="button">Renombrar capa</button>
        <button class="catalog-context-action" id="contextUpdateStationBtn" type="button">Update parameters</button>
        <button class="catalog-context-action" id="contextToggleHeatMapBtn" type="button">Mostrar heat map</button>
        <button class="catalog-context-action" id="contextExplainBtn" type="button">${uiText("explainParams")}</button>
        <button class="catalog-context-action" id="contextVizBtn" type="button">${uiText("vizOptions")}</button>
        <div class="catalog-context-separator"></div>
        <button class="catalog-context-action" id="contextGroundTrackBtn" type="button">Ground Track Show</button>
        <button class="catalog-context-action" id="contextExportBtn" type="button">Exportar...</button>
        <div class="catalog-context-separator"></div>
        <button class="catalog-context-action danger" id="contextRemoveLayerBtn" type="button">Eliminar capa</button>
    `;
    // React presents the visible layer context menu.

    const folderContextMenu = document.createElement("div");
    folderContextMenu.id = "folderContextMenu";
    folderContextMenu.innerHTML = `
        <div class="folder-add-menu"><button class="catalog-context-action" type="button">Add <span>›</span></button><div class="folder-add-submenu">
            <button class="catalog-context-action" data-folder-action="satellite" type="button">Satélite</button>
            <button class="catalog-context-action" data-folder-action="station" type="button">Estación de tierra</button>
        </div></div>
        <button class="catalog-context-action" data-folder-action="create" type="button">Nueva subcarpeta</button>
        <div class="catalog-context-separator"></div>
        <button class="catalog-context-action" data-folder-action="delete" type="button">Eliminar carpeta</button>`;
    document.body.appendChild(folderContextMenu);

    const folderNameModal = document.createElement("div");
    folderNameModal.id = "folderNameModal";
    folderNameModal.innerHTML = `
        <form class="folder-name-dialog" aria-labelledby="folderNameDialogTitle">
            <h3 id="folderNameDialogTitle">Nueva carpeta</h3>
            <label>
                <span id="folderNameDialogLabel">Nombre de la carpeta</span>
                <input id="folderNameDialogInput" type="text" maxlength="80" autocomplete="off" required />
            </label>
            <div>
                <button type="button" data-folder-dialog="cancel">Cancelar</button>
                <button type="submit" data-folder-dialog="confirm">Crear carpeta</button>
            </div>
        </form>`;
    // React owns the visible folder-name dialog.
    const folderNameDialogTitle = folderNameModal.querySelector("#folderNameDialogTitle");
    const folderNameDialogLabel = folderNameModal.querySelector("#folderNameDialogLabel");
    const folderNameDialogInput = folderNameModal.querySelector("#folderNameDialogInput");
    let resolveFolderNameDialog = null;

    function closeFolderNameDialog(value = null) {
        folderNameModal.classList.remove("open");
        const resolve = resolveFolderNameDialog;
        resolveFolderNameDialog = null;
        resolve?.(value);
    }

    function requestFolderName({ title, label, initialValue = "" }) {
        return new Promise((resolve) => {
            const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const onResponse = (event) => {
                if (event.detail?.id !== id) return;
                window.removeEventListener("orbit:folder-name-response", onResponse);
                resolve(event.detail.name || null);
            };
            window.addEventListener("orbit:folder-name-response", onResponse);
            window.dispatchEvent(new CustomEvent("orbit:folder-name-request", { detail: { id, title, label, initialValue } }));
        });
    }

    folderNameModal.addEventListener("click", (event) => {
        if (event.target === folderNameModal || event.target.closest('[data-folder-dialog="cancel"]')) {
            closeFolderNameDialog();
        }
    });
    folderNameModal.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        const name = folderNameDialogInput.value.trim();
        if (name) closeFolderNameDialog(name);
        else folderNameDialogInput.focus();
    });
    let folderContextTarget = null;
    let pendingFolderAssignment = null;

    function openFolderContextMenu(folder, x, y) {
        folderContextTarget = folder;
        folderContextMenu.style.left = `${Math.max(8, x)}px`;
        folderContextMenu.style.top = `${Math.max(8, y)}px`;
        folderContextMenu.classList.add("open");
    }

    folderContextMenu.addEventListener("click", async (event) => {
        const action = event.target.closest("[data-folder-action]")?.dataset.folderAction;
        const folder = folderContextTarget;
        folderContextMenu.classList.remove("open");
        if (!action || !folder) return;
        if (action === "satellite") {
            pendingFolderAssignment = { folderId: folder.id, knownIds: new Set(getRenderableLayerIds()) };
            onRequestAddSatellite?.();
            waitAndOpenCatalog();
            return;
        }
        if (action === "station") {
            pendingFolderAssignment = { folderId: folder.id, knownIds: new Set(getRenderableLayerIds()) };
            openGroundStationModal();
            return;
        }
        if (action === "create") {
            const name = await requestFolderName({ title: "Nueva subcarpeta", label: "Nombre de la subcarpeta" });
            if (layerTree.createFolder(name, folder.id)) renderList();
            return;
        }
        const tree = layerTree.snapshot(getRenderableLayerIds());
        const hasContent = tree.folders.some((item) => item.parentId === folder.id)
            || Object.values(tree.layerParents).some((parentId) => parentId === folder.id);
        if (!hasContent || window.confirm(`La carpeta '${folder.name}' contiene elementos. ¿Eliminarla y devolver su contenido a la raíz?`)) {
            const foldersToDelete = new Set([folder.id]);
            let foundNestedFolder = true;
            while (foundNestedFolder) {
                foundNestedFolder = false;
                tree.folders.forEach((item) => {
                    if (foldersToDelete.has(item.parentId) && !foldersToDelete.has(item.id)) {
                        foldersToDelete.add(item.id);
                        foundNestedFolder = true;
                    }
                });
            }
            Object.entries(tree.layerParents).forEach(([layerId, parentId]) => {
                if (foldersToDelete.has(parentId)) onToggleObjectLayer(layerId, false);
            });
            layerTree.removeFolder(folder.id);
            renderList();
        }
    });

    document.addEventListener("pointerdown", (event) => {
        if (!contextMenu.contains(event.target) && !event.target.closest?.("#catalogContextMenu")) closeContextMenu();
        if (!folderContextMenu.contains(event.target)) folderContextMenu.classList.remove("open");
        const detailsPanel = document.querySelector(".object-details-panel");
        if (!listRoot.contains(event.target) && !contextMenu.contains(event.target) && !folderContextMenu.contains(event.target) && !detailsPanel?.contains(event.target) && selectedId) {
            selectedId = null;
            renderList();
            renderInfo();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        closeContextMenu();
        folderContextMenu.classList.remove("open");
        closeFolderNameDialog();
    });

    const addMenu = document.createElement("div");
    addMenu.id = "layerAddMenu";
    addMenu.innerHTML = `
        <button class="catalog-context-action" id="addSatelliteLayerBtn" type="button">Añadir satelite</button>
        <button class="catalog-context-action" id="addFolderBtn" type="button">Nueva carpeta</button>
        <button class="catalog-context-action" id="addGroundStationBtn" type="button">Añadir estacion de tierra</button>
    `;
    document.body.appendChild(addMenu);
    const addLayerEntry = document.createElement("div");
    addLayerEntry.className = "folder-add-menu";
    addLayerEntry.innerHTML = `<button class="catalog-context-action" type="button">Add layer <span>›</span></button><div class="folder-add-submenu"><button class="catalog-context-action" data-add-kind="satellite" type="button">Satélite</button><button class="catalog-context-action" data-add-kind="station" type="button">Estación de tierra</button></div>`;
    addLayerEntry.querySelector('[data-add-kind="satellite"]').addEventListener("click", () => addSatelliteLayerBtn.click());
    addLayerEntry.querySelector('[data-add-kind="station"]').addEventListener("click", () => addGroundStationBtn.click());
    addMenu.prepend(addLayerEntry);
    const projectActionsEntry = document.createElement("div");
    projectActionsEntry.className = "folder-add-menu project-actions-entry";
    projectActionsEntry.innerHTML = `
        <button class="catalog-context-action" type="button">Manage project <span>›</span></button>
        <div class="folder-add-submenu">
            <button class="catalog-context-action" data-project-action="new" type="button">Nuevo proyecto</button>
            <button class="catalog-context-action" data-project-action="open" type="button">Abrir proyecto</button>
            <button class="catalog-context-action" data-project-action="save" type="button">Guardar proyecto</button>
            <button class="catalog-context-action" data-project-action="export" type="button">Exportar proyecto</button>
        </div>
    `;
    projectActionsEntry.querySelectorAll("[data-project-action]").forEach((button) => {
        button.addEventListener("click", () => {
            closeAddMenu();
            window.dispatchEvent(new CustomEvent("orbit:project-action", { detail: button.dataset.projectAction }));
        });
    });
    addMenu.prepend(projectActionsEntry);

    const groundStationModal = document.createElement("div");
    groundStationModal.id = "groundStationModal";
    groundStationModal.innerHTML = `
        <div class="catalog-filter-panel ground-station-panel" role="dialog" aria-modal="true" aria-label="Nueva estacion terrestre" id="groundStationPanel">
            <div class="catalog-filter-header">
                <h3 id="groundStationTitle">Nueva estacion terrestre</h3>
                <button class="catalog-close-btn" id="groundStationCloseBtn" type="button" aria-label="Cerrar">✕</button>
            </div>
            <div class="ground-station-tabs" id="groundStationTabs">
                <button type="button" class="ground-station-tab-btn active" data-gs-tab="general">General</button>
                <button type="button" class="ground-station-tab-btn" data-gs-tab="radio">Radio</button>
                <button type="button" class="ground-station-tab-btn" data-gs-tab="visual">Visual</button>
                <button type="button" class="ground-station-tab-btn" data-gs-tab="heatmap">Heat map</button>
            </div>
            <div class="ground-station-tab-panel active" data-gs-tab-panel="general">
                <div class="catalog-filter-grid ground-station-grid">
                    <label class="catalog-filter-field">
                        <span>Nombre de capa</span>
                        <input id="gsNameInput" type="text" placeholder="Estacion Madrid" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Latitud (deg)</span>
                        <input id="gsLatInput" type="number" step="0.000001" min="-90" max="90" value="40.4168" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Longitud (deg)</span>
                        <input id="gsLonInput" type="number" step="0.000001" min="-180" max="180" value="-3.7038" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Altitud (m)</span>
                        <input id="gsAltInput" type="number" step="1" min="0" value="667" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Mascara elevacion (deg)</span>
                        <input id="gsMaskInput" type="number" step="0.1" min="0" max="90" value="10" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Radio cobertura (km)</span>
                        <input id="gsCoverageRadiusInput" type="number" step="1" min="1" value="1200" />
                    </label>
                </div>
            </div>
            <div class="ground-station-tab-panel" data-gs-tab-panel="radio">
                <div class="catalog-filter-grid ground-station-grid">
                    <label class="catalog-filter-field">
                        <span>Frecuencia (MHz)</span>
                        <input id="gsFreqInput" type="number" step="0.1" min="1" value="2200" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Potencia TX (dBm)</span>
                        <input id="gsTxPowerInput" type="number" step="0.1" value="38" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Ganancia TX (dBi)</span>
                        <input id="gsTxGainInput" type="number" step="0.1" value="18" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Ganancia RX (dBi)</span>
                        <input id="gsRxGainInput" type="number" step="0.1" value="21" />
                    </label>
                </div>
            </div>
            <div class="ground-station-tab-panel" data-gs-tab-panel="visual">
                <div class="catalog-filter-grid ground-station-grid">
                    <label class="catalog-filter-field">
                        <span>Tamano simbolo (px)</span>
                        <input id="gsPointSizeInput" type="number" step="1" min="4" max="48" value="11" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Simbolo</span>
                        <select id="gsPointSymbolInput">
                            <option value="circle">Circulo</option>
                            <option value="square">Cuadrado</option>
                            <option value="triangle">Triangulo</option>
                            <option value="diamond">Diamante</option>
                            <option value="star">Estrella</option>
                        </select>
                    </label>
                    <label class="catalog-filter-field">
                        <span>Color simbolo</span>
                        <input id="gsPointColorInput" type="color" value="#3cc4ff" />
                    </label>
                    <label class="catalog-filter-field checkbox">
                        <span>Mostrar circulo cobertura</span>
                        <input id="gsCoverageVisibleInput" type="checkbox" checked />
                    </label>
                </div>
            </div>
            <div class="ground-station-tab-panel" data-gs-tab-panel="heatmap">
                <div class="catalog-filter-grid ground-station-grid">
                    <label class="catalog-filter-field checkbox">
                        <span>Heat map acumulado</span>
                        <input id="gsHeatEnabledInput" type="checkbox" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Densidad heat map</span>
                        <select id="gsHeatDensityInput">
                            <option value="low">Baja</option>
                            <option value="medium" selected>Media</option>
                            <option value="high">Alta</option>
                        </select>
                    </label>
                </div>
            </div>
            <div class="catalog-filter-actions">
                <button class="catalog-action-btn" id="groundStationCreateBtn" type="button">Crear estacion</button>
            </div>
        </div>
    `;
    // React owns the visible ground-station form.

    const exportModal = document.createElement("div");
    exportModal.id = "catalogExportModal";
    exportModal.innerHTML = `
        <div class="catalog-export-panel" role="dialog" aria-modal="true" aria-label="Exportar satelite">
            <div class="catalog-export-header">
                <h3>Exportar satelite</h3>
                <button class="catalog-close-btn" id="catalogExportCloseBtn" type="button" aria-label="Cerrar exportacion" title="Cerrar">✕</button>
            </div>
            <div class="catalog-export-target" id="catalogExportTarget">-</div>
            <div class="catalog-export-source" id="catalogExportSource">Source: -</div>

            <section class="catalog-export-section">
                <h4>Exportar fichero de origen</h4>
                <div class="catalog-export-buttons">
                    <button class="catalog-header-btn" id="exportTleBtn" type="button">Exportar TLE</button>
                    <button class="catalog-header-btn" id="exportOmmJsonBtn" type="button">Exportar OMM (JSON)</button>
                    <button class="catalog-header-btn" id="exportOmmXmlBtn" type="button">Exportar OMM (XML)</button>
                    <button class="catalog-header-btn" id="exportOemBtn" type="button">Exportar OEM</button>
                </div>
            </section>

            <section class="catalog-export-section">
                <h4>Exportar efemerides entre dos fechas</h4>
                <div class="catalog-export-grid">
                    <label class="catalog-filter-field">
                        <span>Fecha inicio</span>
                        <input id="exportEphemStart" type="datetime-local" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Fecha fin</span>
                        <input id="exportEphemEnd" type="datetime-local" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Intervalo (s)</span>
                        <input id="exportEphemStep" type="number" min="1" max="3600" step="1" value="10" />
                    </label>
                    <label class="catalog-filter-field">
                        <span>Formato</span>
                        <select id="exportEphemFormat">
                            <option value="csv">CSV</option>
                            <option value="json">JSON</option>
                            <option value="oem">OEM</option>
                        </select>
                    </label>
                    <label class="catalog-filter-field">
                        <span>Propagador</span>
                        <select id="exportEphemPropagator">
                            <option value="sgp4">SGP4</option>
                        </select>
                    </label>
                </div>
                <div class="catalog-export-actions">
                    <button class="catalog-action-btn" id="exportEphemerisBtn" type="button">Exportar efemerides</button>
                </div>
            </section>
        </div>
    `;
    // React renders the visible export dialog.

    const header = sidebar.querySelector("#objectSidebarHeader");
    const removeAllLayersHeaderBtn = sidebar.querySelector("#removeAllLayersHeaderBtn") || document.getElementById("removeAllLayersHeaderBtn");
    const toggleAllVisibilityBtn = sidebar.querySelector("#toggleAllVisibilityBtn") || document.getElementById("toggleAllVisibilityBtn");
    const openCatalogBtn = sidebar.querySelector("#openCatalogBtn") || document.getElementById("openCatalogBtn");
    // In the React layout the Layers search is a sibling of this legacy list
    // container, so prefer it before falling back to the top-bar search.
    const searchInput = sidebar.querySelector("#objectSearch")
        || document.querySelector("#leftSatellitesPanel #objectSearch")
        || document.getElementById("objectSearch");
    const listRoot = sidebar.querySelector("#objectList");
    const infoRoot = useSeparateInfo
        ? infoContainerElement.querySelector("#objectInfo")
        : sidebar.querySelector("#objectInfo");
    const onInfoTogglePointerDown = (event) => {
        const toggleBtn = event.target?.closest?.("[data-info-toggle]");
        if (!toggleBtn || !infoRoot.contains(toggleBtn)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        const key = toggleBtn.dataset.infoToggle;
        if (!key) {
            return;
        }

        infoSectionOpenState[key] = !(infoSectionOpenState[key] !== false);
        renderInfo();
    };
    infoRoot.addEventListener("pointerdown", onInfoTogglePointerDown);

    const catalogCloseBtn = catalogModal.querySelector("#catalogCloseBtn");
    const catalogImportBtn = catalogModal.querySelector("#catalogImportBtn");
    const catalogImportFileInput = catalogModal.querySelector("#catalogImportFileInput");
    const catalogFiltersBtn = catalogModal.querySelector("#catalogFiltersBtn");
    const catalogRefreshBtn = catalogModal.querySelector("#catalogRefreshBtn");
    const catalogSelectAllBtn = catalogModal.querySelector("#catalogSelectAllBtn");
    const catalogSearchInput = catalogModal.querySelector("#catalogSearch");
    const catalogFilterSummary = catalogModal.querySelector("#catalogFilterSummary");
    const catalogRefreshStatus = catalogModal.querySelector("#catalogRefreshStatus");
    const catalogRefreshText = catalogModal.querySelector("#catalogRefreshText");
    const catalogRefreshBar = catalogModal.querySelector("#catalogRefreshBar");
    const catalogListRoot = catalogModal.querySelector("#catalogList");
    const catalogProgress = catalogModal.querySelector("#catalogProgress");
    const catalogPrevPageBtn = catalogModal.querySelector("#catalogPrevPageBtn");
    const catalogPageInfo = catalogModal.querySelector("#catalogPageInfo");
    const catalogNextPageBtn = catalogModal.querySelector("#catalogNextPageBtn");
    const catalogAddSelectedBtn = catalogModal.querySelector("#catalogAddSelectedBtn");

    const catalogFilterCloseBtn = catalogFilterModal.querySelector("#catalogFilterCloseBtn");
    const catalogFilterNameInput = catalogFilterModal.querySelector("#catalogFilterName");
    const catalogOrbitFilter = catalogFilterModal.querySelector("#catalogOrbitFilter");
    const catalogMissionFilter = catalogFilterModal.querySelector("#catalogMissionFilter");
    const catalogSourceFormatFilter = catalogFilterModal.querySelector("#catalogSourceFormatFilter");
    const catalogDecayOnlyFilter = catalogFilterModal.querySelector("#catalogDecayOnlyFilter");
    const catalogFilterClearBtn = catalogFilterModal.querySelector("#catalogFilterClearBtn");

    const confirmTitle = confirmModal.querySelector("#sidebarConfirmTitle");
    const confirmMessage = confirmModal.querySelector("#sidebarConfirmMessage");
    const confirmCancelBtn = confirmModal.querySelector("#sidebarConfirmCancelBtn");
    const confirmAcceptBtn = confirmModal.querySelector("#sidebarConfirmAcceptBtn");

    const catalogLoadingText = catalogLoadingModal.querySelector("p");

    const contextExplainBtn = contextMenu.querySelector("#contextExplainBtn");
    const contextVizBtn = contextMenu.querySelector("#contextVizBtn");
    const contextGroundTrackBtn = contextMenu.querySelector("#contextGroundTrackBtn");
    const contextExportBtn = contextMenu.querySelector("#contextExportBtn");
    const contextRenameBtn = contextMenu.querySelector("#contextRenameBtn");
    const contextUpdateStationBtn = contextMenu.querySelector("#contextUpdateStationBtn");
    const contextToggleHeatMapBtn = contextMenu.querySelector("#contextToggleHeatMapBtn");
    const contextRemoveLayerBtn = contextMenu.querySelector("#contextRemoveLayerBtn");

    const addSatelliteLayerBtn = addMenu.querySelector("#addSatelliteLayerBtn");
    const addFolderBtn = addMenu.querySelector("#addFolderBtn");
    const addGroundStationBtn = addMenu.querySelector("#addGroundStationBtn");

    const groundStationCloseBtn = groundStationModal.querySelector("#groundStationCloseBtn");
    const groundStationCreateBtn = groundStationModal.querySelector("#groundStationCreateBtn");
    const groundStationTitle = groundStationModal.querySelector("#groundStationTitle");
    const groundStationPanel = groundStationModal.querySelector("#groundStationPanel");
    const gsNameInput = groundStationModal.querySelector("#gsNameInput");
    const gsLatInput = groundStationModal.querySelector("#gsLatInput");
    const gsLonInput = groundStationModal.querySelector("#gsLonInput");
    const gsAltInput = groundStationModal.querySelector("#gsAltInput");
    const gsMaskInput = groundStationModal.querySelector("#gsMaskInput");
    const gsFreqInput = groundStationModal.querySelector("#gsFreqInput");
    const gsTxPowerInput = groundStationModal.querySelector("#gsTxPowerInput");
    const gsTxGainInput = groundStationModal.querySelector("#gsTxGainInput");
    const gsRxGainInput = groundStationModal.querySelector("#gsRxGainInput");
    const gsCoverageRadiusInput = groundStationModal.querySelector("#gsCoverageRadiusInput");
    const gsPointSizeInput = groundStationModal.querySelector("#gsPointSizeInput");
    const gsPointSymbolInput = groundStationModal.querySelector("#gsPointSymbolInput");
    const gsPointColorInput = groundStationModal.querySelector("#gsPointColorInput");
    const gsCoverageVisibleInput = groundStationModal.querySelector("#gsCoverageVisibleInput");
    const gsHeatEnabledInput = groundStationModal.querySelector("#gsHeatEnabledInput");
    const gsHeatDensityInput = groundStationModal.querySelector("#gsHeatDensityInput");
    const gsTabButtons = groundStationModal.querySelectorAll("[data-gs-tab]");
    const gsTabPanels = groundStationModal.querySelectorAll("[data-gs-tab-panel]");

    const setGroundStationTab = (tabId) => {
        const safeTab = String(tabId || "general").toLowerCase();
        gsTabButtons.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.gsTab === safeTab);
        });
        gsTabPanels.forEach((panel) => {
            panel.classList.toggle("active", panel.dataset.gsTabPanel === safeTab);
        });
    };

    gsTabButtons.forEach((btn) => {
        btn.addEventListener("click", () => setGroundStationTab(btn.dataset.gsTab));
    });

    const catalogExportCloseBtn = exportModal.querySelector("#catalogExportCloseBtn");
    const catalogExportTarget = exportModal.querySelector("#catalogExportTarget");
    const catalogExportSource = exportModal.querySelector("#catalogExportSource");
    const exportTleBtn = exportModal.querySelector("#exportTleBtn");
    const exportOmmJsonBtn = exportModal.querySelector("#exportOmmJsonBtn");
    const exportOmmXmlBtn = exportModal.querySelector("#exportOmmXmlBtn");
    const exportOemBtn = exportModal.querySelector("#exportOemBtn");
    const exportEphemStartInput = exportModal.querySelector("#exportEphemStart");
    const exportEphemEndInput = exportModal.querySelector("#exportEphemEnd");
    const exportEphemStepInput = exportModal.querySelector("#exportEphemStep");
    const exportEphemFormatSelect = exportModal.querySelector("#exportEphemFormat");
    const exportEphemPropagatorSelect = exportModal.querySelector("#exportEphemPropagator");
    const exportEphemerisBtn = exportModal.querySelector("#exportEphemerisBtn");

    const notificationCenter = document.createElement("div");
    notificationCenter.id = "sidebarNotificationCenter";
    notificationCenter.innerHTML = `
        <button id="sidebarNotificationToggle" type="button">Alertas (0)</button>           
        <div id="sidebarNotificationPanel" hidden>
            <div class="sidebar-notification-actions">
                <button id="sidebarNotificationClearAll" type="button">Limpiar todo</button>
            </div>
            <div id="sidebarNotificationList"></div>
        </div>
    `;
    // React renders the notification center. Keep this detached during the
    // transition so the runtime can continue publishing the same event data.

    const notificationToggle = notificationCenter.querySelector("#sidebarNotificationToggle");
    const notificationPanel = notificationCenter.querySelector("#sidebarNotificationPanel");
    const notificationList = notificationCenter.querySelector("#sidebarNotificationList");
    const notificationClearAll = notificationCenter.querySelector("#sidebarNotificationClearAll");
    const notificationState = {
        sequence: 1,
        entries: []
    };

    function renderNotifications() {
        window.dispatchEvent(new CustomEvent("orbit:notifications", {
            detail: notificationState.entries.map((entry) => ({ ...entry }))
        }));

        notificationList.innerHTML = "";
        for (const entry of notificationState.entries) {
            const item = document.createElement("article");
            item.className = `sidebar-notification-item ${entry.type === "error" ? "is-error" : "is-info"}`;
            item.innerHTML = `
                <div class="sidebar-notification-head">
                    <strong>${entry.type === "error" ? "Error" : "Info"}</strong>
                    <button type="button" data-dismiss-id="${entry.id}" aria-label="Cerrar alerta">✕</button>
                </div>
                <pre>${escapeHtml(entry.message)}</pre>
            `;
            notificationList.appendChild(item);
        }
    }

    function dismissNotification(id) {
        notificationState.entries = notificationState.entries.filter((entry) => entry.id !== id);
        renderNotifications();
    }

    function pushNotification(message, type = "info", { sticky = false, autoHideMs = 0 } = {}) {
        const entry = {
            id: notificationState.sequence++,
            type,
            message: String(message || "")
        };
        notificationState.entries.unshift(entry);
        notificationState.entries = notificationState.entries.slice(0, 80);
        renderNotifications();

        if (!sticky && Number(autoHideMs) > 0) {
            setTimeout(() => dismissNotification(entry.id), Number(autoHideMs));
        }
    }

    window.addEventListener("orbit:clear-notifications", () => {
        notificationState.entries = [];
        renderNotifications();
    });

    window.addEventListener("orbit:dismiss-notification", (event) => {
        dismissNotification(Number(event.detail));
    });

    renderNotifications();

    function makeMovablePanel(modalRoot, panelNode, dragHandleNode) {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;

        const applyTransform = () => {
            panelNode.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        };

        const onPointerMove = (event) => {
            if (!dragging) {
                return;
            }
            const clientX = Number(event.clientX);
            const clientY = Number(event.clientY);
            if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
                return;
            }
            offsetX += clientX - startX;
            offsetY += clientY - startY;
            startX = clientX;
            startY = clientY;
            applyTransform();
        };

        const stop = () => {
            dragging = false;
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", stop);
        };

        dragHandleNode.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) {
                return;
            }
            if (event.target.closest("button")) {
                return;
            }
            dragging = true;
            startX = event.clientX;
            startY = event.clientY;
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", stop);
            event.preventDefault();
        });

        modalRoot.addEventListener("transitionend", () => {
            if (!modalRoot.classList.contains("open")) {
                panelNode.style.transform = "translate(0px, 0px)";
                offsetX = 0;
                offsetY = 0;
            }
        });
    }

    makeMovablePanel(groundStationModal, groundStationPanel, groundStationPanel.querySelector(".catalog-filter-header"));

    function askConfirmation({ title, message, confirmText, cancelText }) {
        return new Promise((resolve) => {
            const id = `confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const onResponse = (event) => {
                if (event.detail?.id !== id) return;
                window.removeEventListener("orbit:confirm-response", onResponse);
                resolve(event.detail.accepted === true);
            };
            window.addEventListener("orbit:confirm-response", onResponse);
            window.dispatchEvent(new CustomEvent("orbit:confirm-request", {
                detail: { id, title, message, confirmText: confirmText || uiText("confirmBtn"), cancelText: cancelText || uiText("cancelBtn") }
            }));
        });
    }

    const openSidebar = () => {
        if (!useContainer) {
            sidebar.classList.add("open");
            if (header) {
                header.setAttribute("aria-expanded", "true");
            }
        }
    };

    const closeSidebar = () => {
        if (!useContainer) {
            sidebar.classList.remove("open");
            if (header) {
                header.setAttribute("aria-expanded", "false");
            }
        }
    };

    const toggleSidebar = () => {
        if (useContainer) return;
        if (sidebar.classList.contains("open")) {
            closeSidebar();
        } else {
            openSidebar();
        }
    };

    const openCatalogModal = () => {
        catalogModal.classList.add("open");
        window.dispatchEvent(new Event("orbit:catalog-open"));
        // asegurar que la barra de progreso está oculta al abrir
        stopCatalogRefreshProgressTimer();
        setCatalogRefreshState({
            visible: false,
            text: "",
            value: 0
        });
        catalogProgress.textContent = "";
        syncCatalogFilterControls();
        renderCatalogList();
        catalogSearchInput.focus();
    };

    const closeCatalogModal = () => {
        catalogRenderToken += 1;
        stopCatalogRefreshProgressTimer();
        setCatalogRefreshState({ visible: false, text: "", value: 0 });
        catalogProgress.textContent = "";
        catalogModal.classList.remove("open");
        window.dispatchEvent(new Event("orbit:catalog-close"));
        catalogFilterModal.classList.remove("open");
        closeContextMenu();
    };

    function openCatalogFilterModal() {
        syncCatalogFilterControls();
        catalogFilterModal.classList.add("open");
        catalogFilterNameInput.focus();
    }

    function closeCatalogFilterModal() {
        catalogFilterModal.classList.remove("open");
    }

    function buildFilterChip(key, label, value) {
        return `
            <span class="catalog-filter-chip">
                <strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}
                <button
                    type="button"
                    class="catalog-filter-chip-remove"
                    data-filter-key="${escapeHtml(key)}"
                    aria-label="Quitar filtro ${escapeHtml(label)}"
                    title="Quitar filtro"
                >✕</button>
            </span>
        `;
    }

    function updateCatalogFilterSummary() {
        const chips = [];
        if (catalogFilterState.name) chips.push(buildFilterChip("name", "Nombre", catalogFilterState.name));
        if (catalogFilterState.orbitKind) chips.push(buildFilterChip("orbitKind", "Orbita", orbitFilterLabel(catalogFilterState.orbitKind)));
        if (catalogFilterState.mission) chips.push(buildFilterChip("mission", "Mision", missionFilterLabel(catalogFilterState.mission)));
        if (catalogFilterState.sourceFormat) chips.push(buildFilterChip("sourceFormat", "Formato", catalogFilterState.sourceFormat));
        if (catalogFilterState.decayOnly) chips.push(buildFilterChip("decayOnly", "Decay", "Perigeo bajo"));
        catalogFilterSummary.innerHTML = chips.join("");
        catalogFilterSummary.hidden = chips.length === 0;
    }

    function populateCatalogSelect(selectEl, options, selectedValue, allLabel) {
        const nextValue = options.some((option) => option.value === selectedValue) ? selectedValue : "";
        selectEl.innerHTML = "";

        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = allLabel;
        selectEl.appendChild(allOption);

        for (const option of options) {
            const optionEl = document.createElement("option");
            optionEl.value = option.value;
            optionEl.textContent = option.label;
            selectEl.appendChild(optionEl);
        }

        selectEl.value = nextValue;
        return nextValue;
    }

    function syncCatalogFilterControls() {
        const orbitOptions = ORBIT_FILTER_ORDER.map((kind) => ({
            value: kind,
            label: orbitFilterLabel(kind)
        }));
        const missionOptions = MISSION_FILTER_ORDER.map((value) => ({
            value,
            label: missionFilterLabel(value)
        }));
        const sourceFormatOptions = ["TLE", "OMM", "OEM"].map((value) => ({ value, label: value }));

        catalogFilterState.orbitKind = populateCatalogSelect(catalogOrbitFilter, orbitOptions, catalogFilterState.orbitKind, "Todas las orbitas");
        catalogFilterState.mission = populateCatalogSelect(catalogMissionFilter, missionOptions, catalogFilterState.mission, "Todas las misiones");
        catalogFilterState.sourceFormat = populateCatalogSelect(catalogSourceFormatFilter, sourceFormatOptions, catalogFilterState.sourceFormat, "Todos los formatos");
        catalogSearchInput.value = catalogFilterState.name;
        catalogFilterNameInput.value = catalogFilterState.name;
        catalogDecayOnlyFilter.checked = catalogFilterState.decayOnly === true;
        updateCatalogFilterSummary();
    }

    function applyCatalogFilters(nextState = {}) {
        if (Object.prototype.hasOwnProperty.call(nextState, "name")) {
            catalogFilterState.name = String(nextState.name || "").toLowerCase().trim();
        }
        if (Object.prototype.hasOwnProperty.call(nextState, "orbitKind")) {
            catalogFilterState.orbitKind = String(nextState.orbitKind || "");
        }
        if (Object.prototype.hasOwnProperty.call(nextState, "mission")) {
            catalogFilterState.mission = String(nextState.mission || "");
        }
        if (Object.prototype.hasOwnProperty.call(nextState, "sourceFormat")) {
            catalogFilterState.sourceFormat = String(nextState.sourceFormat || "").toUpperCase();
        }
        if (Object.prototype.hasOwnProperty.call(nextState, "decayOnly")) {
            catalogFilterState.decayOnly = nextState.decayOnly === true;
        }

        syncCatalogFilterControls();
        renderCatalogList();
    }

    function closeContextMenu() {
        window.dispatchEvent(new Event("orbit:layer-context-menu-close"));
        contextTargetId = null;
    }

    function closeAddMenu() {
        addMenu.classList.remove("open");
    }

    function openAddMenu(anchorElement) {
        if (!anchorElement) {
            return;
        }
        // Project-level actions belong only to the root project's Add button,
        // never to the Add controls rendered inside individual folders.
        projectActionsEntry.hidden = anchorElement !== openCatalogBtn;
        const rect = anchorElement.getBoundingClientRect();
        const menuWidth = 280;
        const menuHeight = 180;
        const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuWidth - 8));
        const top = Math.min(Math.max(8, rect.bottom + 6), Math.max(8, window.innerHeight - menuHeight - 8));
        addMenu.style.left = `${left}px`;
        addMenu.style.top = `${top}px`;
        addMenu.classList.add("open");
    }

    function openGroundStationModal(layerId = null) {
        closeAddMenu();
        editingGroundStationId = layerId ? String(layerId) : null;

        const isEditing = Boolean(editingGroundStationId);
        groundStationTitle.textContent = isEditing ? "Update parameters" : "Nueva estacion terrestre";
        groundStationCreateBtn.textContent = isEditing ? "Guardar cambios" : "Crear estacion";

        if (isEditing && typeof getGroundStationParams === "function") {
            const current = getGroundStationParams(editingGroundStationId) || {};
            gsNameInput.value = String(current.name || "");
            gsLatInput.value = String(Number(current.latitude_deg ?? 0));
            gsLonInput.value = String(Number(current.longitude_deg ?? 0));
            gsAltInput.value = String(Number(current.altitude_m ?? 0));
            gsMaskInput.value = String(Number(current.min_elevation_deg ?? 10));
            gsFreqInput.value = String(Number(current.frequency_mhz ?? 2200));
            gsTxPowerInput.value = String(Number(current.tx_power_dbm ?? 38));
            gsTxGainInput.value = String(Number(current.tx_gain_dbi ?? 18));
            gsRxGainInput.value = String(Number(current.rx_gain_dbi ?? 21));
            gsCoverageRadiusInput.value = String(Number(current.coverage_radius_km ?? 1200));
            gsPointSizeInput.value = String(Number(current.point_size_px ?? 11));
            gsPointSymbolInput.value = String(current.point_symbol || "circle");
            gsPointColorInput.value = String(current.point_color || "#3cc4ff");
            gsCoverageVisibleInput.checked = current.coverage_visible !== false;
            gsHeatEnabledInput.checked = current.heatmap_enabled !== false;
            gsHeatDensityInput.value = String(current.heatmap_density || "medium").toLowerCase();
        } else {
            gsNameInput.value = "";
            gsLatInput.value = "40.4168";
            gsLonInput.value = "-3.7038";
            gsAltInput.value = "667";
            gsMaskInput.value = "10";
            gsFreqInput.value = "2200";
            gsTxPowerInput.value = "38";
            gsTxGainInput.value = "18";
            gsRxGainInput.value = "21";
            gsCoverageRadiusInput.value = "1200";
            gsPointSizeInput.value = "11";
            gsPointSymbolInput.value = "circle";
            gsPointColorInput.value = "#3cc4ff";
            gsCoverageVisibleInput.checked = true;
            gsHeatEnabledInput.checked = false;
            gsHeatDensityInput.value = "medium";
        }

        setGroundStationTab("general");

        groundStationModal.classList.add("open");
        window.dispatchEvent(new CustomEvent("orbit:ground-station-open", {
            detail: { editing: isEditing, values: {
                name: gsNameInput.value, latitude_deg: gsLatInput.value, longitude_deg: gsLonInput.value, altitude_m: gsAltInput.value,
                min_elevation_deg: gsMaskInput.value, frequency_mhz: gsFreqInput.value, tx_power_dbm: gsTxPowerInput.value, tx_gain_dbi: gsTxGainInput.value,
                rx_gain_dbi: gsRxGainInput.value, coverage_radius_km: gsCoverageRadiusInput.value, point_size_px: gsPointSizeInput.value,
                point_symbol: gsPointSymbolInput.value, point_color: gsPointColorInput.value, coverage_visible: gsCoverageVisibleInput.checked,
                heatmap_enabled: gsHeatEnabledInput.checked, heatmap_density: gsHeatDensityInput.value
            } }
        }));
        gsNameInput?.focus();
    }

    function closeGroundStationModal() {
        editingGroundStationId = null;
        groundStationModal.classList.remove("open");
        window.dispatchEvent(new Event("orbit:ground-station-close"));
    }

    async function submitGroundStation() {
        const payload = {
            name: String(gsNameInput?.value || "").trim() || "Estacion terrestre",
            latitude_deg: Number(gsLatInput?.value),
            longitude_deg: Number(gsLonInput?.value),
            altitude_m: Number(gsAltInput?.value),
            min_elevation_deg: Number(gsMaskInput?.value),
            frequency_mhz: Number(gsFreqInput?.value),
            tx_power_dbm: Number(gsTxPowerInput?.value),
            tx_gain_dbi: Number(gsTxGainInput?.value),
            rx_gain_dbi: Number(gsRxGainInput?.value),
            coverage_radius_km: Number(gsCoverageRadiusInput?.value),
            point_size_px: Number(gsPointSizeInput?.value),
            point_symbol: String(gsPointSymbolInput?.value || "circle").trim(),
            point_color: String(gsPointColorInput?.value || "#3cc4ff").trim(),
            coverage_visible: gsCoverageVisibleInput?.checked !== false,
            heatmap_enabled: gsHeatEnabledInput?.checked === true,
            heatmap_density: String(gsHeatDensityInput?.value || "medium").trim().toLowerCase()
        };

        if (!Number.isFinite(payload.latitude_deg) || payload.latitude_deg < -90 || payload.latitude_deg > 90) {
            showErrorPopup("Latitud invalida para la estacion.");
            return;
        }

        if (!Number.isFinite(payload.longitude_deg) || payload.longitude_deg < -180 || payload.longitude_deg > 180) {
            showErrorPopup("Longitud invalida para la estacion.");
            return;
        }

        if (editingGroundStationId) {
            if (typeof onRequestUpdateGroundStation !== "function") {
                showErrorPopup("La edicion de estaciones no esta disponible en este contexto.");
                return;
            }
            const updated = await onRequestUpdateGroundStation(editingGroundStationId, payload);
            if (!updated) {
                showErrorPopup("No se pudo actualizar la estacion terrestre.");
                return;
            }
            selectedId = editingGroundStationId;
            onSelectObject?.(selectedId);
            renderList();
            renderInfo();
            closeGroundStationModal();
            showInfoPopup(`Estacion actualizada: ${payload.name}`);
            return;
        }

        if (typeof onRequestCreateGroundStation !== "function") {
            showErrorPopup("La creacion de estaciones no esta disponible en este contexto.");
            return;
        }

        const createdId = await onRequestCreateGroundStation(payload);
        if (!createdId) {
            showErrorPopup("No se pudo crear la estacion terrestre.");
            return;
        }

        selectedId = createdId;
        onSelectObject?.(selectedId);
        renderList();
        renderInfo();
        closeGroundStationModal();
        showInfoPopup(`Estacion creada: ${payload.name}`);
    }

    function isFileDragEvent(event) {
        const types = event?.dataTransfer?.types;
        return Boolean(types && Array.from(types).includes("Files"));
    }

    function setGlobalDropOverlayVisible(visible) {
        window.dispatchEvent(new CustomEvent("orbit:catalog-drop-overlay", { detail: visible === true }));
    }

    function toDatetimeLocalValue(date) {
        const d = new Date(date);
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function openExportModal(id) {
        if (!id) {
            return;
        }
        const entryMeta = getCatalogEntryMeta?.(id) || null;
        const sourceFormat = String(entryMeta?.sourceFormat || "TLE").trim().toUpperCase();
        exportSourceFormat = sourceFormat === "OMM" || sourceFormat === "OEM" ? sourceFormat : "TLE";

        catalogExportTarget.textContent = id;
        catalogExportSource.textContent = `Source: ${exportSourceFormat}`;
        exportTleBtn.hidden = exportSourceFormat !== "TLE";
        exportOmmJsonBtn.hidden = exportSourceFormat !== "OMM";
        exportOmmXmlBtn.hidden = exportSourceFormat !== "OMM";
        exportOemBtn.hidden = exportSourceFormat !== "OEM";

        const now = new Date();
        const tomorrow = new Date(now.getTime() + (24 * 3600 * 1000));
        exportEphemStartInput.value = toDatetimeLocalValue(now);
        exportEphemEndInput.value = toDatetimeLocalValue(tomorrow);
        exportEphemStepInput.value = "10";
        exportEphemFormatSelect.value = "oem";
        exportEphemPropagatorSelect.value = "sgp4";
        exportModal.classList.add("open");
        window.dispatchEvent(new CustomEvent("orbit:export-open", { detail: { id, sourceFormat: exportSourceFormat } }));
    }

    function closeExportModal() {
        exportModal.classList.remove("open");
        window.dispatchEvent(new Event("orbit:export-close"));
    }

    async function downloadFromUrl(url, fallbackFileName) {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) {
            let detail = "";
            try {
                const payload = await response.json();
                detail = payload?.error || payload?.detail || "";
            } catch {
                detail = "";
            }
            throw new Error(detail || `HTTP ${response.status}`);
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get("content-disposition") || "";
        const match = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition);
        const fileName = (match?.[1] || fallbackFileName || "export.dat").trim();

        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
    }

    function showErrorPopup(message) {
        pushNotification(message, "error", { sticky: true });
    }

    function showInfoPopup(message) {
        pushNotification(message, "info", { sticky: false, autoHideMs: 6500 });
    }

    function getLayerCapacity() {
        const maxLayers = Number(getMaxActiveLayers?.());
        const safeMaxLayers = Number.isFinite(maxLayers) && maxLayers > 0
            ? Math.floor(maxLayers)
            : 100;
        const availableSlots = Number(getAvailableLayerSlots?.());
        const safeAvailableSlots = Number.isFinite(availableSlots) && availableSlots >= 0
            ? Math.floor(availableSlots)
            : Math.max(0, safeMaxLayers - (Array.isArray(getLayerIds?.()) ? getLayerIds().length : 0));
        return {
            maxLayers: safeMaxLayers,
            availableSlots: safeAvailableSlots
        };
    }

    function stopCatalogRefreshProgressTimer() {
        if (catalogRefreshTimer) {
            clearInterval(catalogRefreshTimer);
            catalogRefreshTimer = null;
        }
    }

    function setCatalogRefreshState({ visible, text = "", value = 0 }) {
        catalogRefreshStatus.hidden = !visible;
        catalogRefreshStatus.style.display = visible ? "grid" : "none";
        catalogRefreshText.hidden = !visible;
        catalogRefreshBar.hidden = !visible;
        catalogRefreshText.textContent = visible ? text : "";
        const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
        catalogRefreshBar.value = visible ? safeValue : 0;
    }

    async function refreshCatalogFromCelestrak() {
        if (catalogBusy || catalogRefreshBusy) {
            return;
        }

        const ok = await askConfirmation({
            title: uiText("updateCatalog"),
            message: uiText("updateCatalogMsg"),
            confirmText: uiText("updateBtn"),
            cancelText: uiText("cancelBtn")
        });

        if (!ok) {
            return;
        }

        catalogRefreshBusy = true;
        if (catalogSearchInput) catalogSearchInput.hidden = true;
        setCatalogBusyState(true, uiText("updatingCatalog"));

        let progress = 4;
        setCatalogRefreshState({
            visible: true,
            text: "Descargando TLE/OMM/OEM...",
            value: progress
        });

        stopCatalogRefreshProgressTimer();
        catalogRefreshTimer = setInterval(() => {
            progress = Math.min(92, progress + Math.max(1, Math.random() * 7));
            setCatalogRefreshState({
                visible: true,
                text: "Procesando catalogo...",
                value: progress
            });
        }, 260);

        try {
            const response = await fetch("/api/catalog/refresh", {
                method: "POST"
            });
            const payload = await response.json().catch(() => null);

            if (!response.ok || !payload?.ok) {
                const rawError = payload?.error || `Error HTTP ${response.status}`;
                if (payload?.rateLimited === true) {
                    showErrorPopup(`Actualizacion aplazada\n\n${rawError}\n\nEl catalogo actual sigue disponible.`);
                    return;
                }
                const isNetworkBlocked = payload?.networkBlocked === true
                    || /bloquea|block|timeout de conexion|cloud|Codespace/i.test(rawError);
                if (isNetworkBlocked) {
                    showErrorPopup(`⚠️ CelesTrak no es accesible desde esta red.\n\nAlternativas:\n• Importa un fichero .tle/.json/.xml/.omm directamente arrastrándolo aquí.\n• Usa un entorno con acceso directo a internet (no cloud/Codespace).\n\nDetalle: ${rawError}`);
                    return;
                }
                throw new Error(rawError);
            }

            setCatalogRefreshState({
                visible: true,
                text: "Recargando catalogo local...",
                value: 96
            });

            if (onRefreshCatalog) {
                await onRefreshCatalog();
            }

            selectedCatalogIds.clear();
            catalogAnchorIndex = null;
            renderCatalogList();
            renderList();
            renderInfo();

            const failedCount = Array.isArray(payload.failedGroups) ? payload.failedGroups.length : 0;
            const failedSourcesCount = Array.isArray(payload.failedSources) ? payload.failedSources.length : 0;
            const discardedInvalid = Number(payload.discardedInvalidEntries) || 0;
            const warningGroups = failedCount > 0 ? `${failedCount} grupos con fallo` : "";
            const warningSources = failedSourcesCount > 0 ? `${failedSourcesCount} fuentes con fallo` : "";
            const warningSuffix = [warningGroups, warningSources].filter(Boolean).join(", ");
            const sourcesInfo = Array.isArray(payload.successfulSources) && payload.successfulSources.length
                ? `, ${payload.successfulSources.length} fuentes procesadas`
                : "";

            const summaryMsg = `Catalogo actualizado: ${payload.writtenEntries || 0} entradas${sourcesInfo}${warningSuffix ? ` (${warningSuffix})` : ""}${discardedInvalid > 0 ? `, ${discardedInvalid} descartadas` : ""}`;

            setCatalogRefreshState({
                visible: true,
                text: summaryMsg,
                value: 100
            });

            // mostrar popup con resultado
            showInfoPopup(summaryMsg);

            if (failedCount > 0 || failedSourcesCount > 0) {
                const failedNames = (payload.failedGroups || [])
                    .map((item) => item.group)
                    .concat((payload.failedSources || []).map((item) => item.source || item.url))
                    .slice(0, 10)
                    .join(", ");
                showErrorPopup(`Actualizacion completada con advertencias. Fallos en: ${failedNames}`);
            }

            if (discardedInvalid > 0) {
                showErrorPopup(`Se descartaron ${discardedInvalid} entradas con formato invalido durante la actualizacion.`);
            }
        } catch (error) {
            setCatalogRefreshState({
                visible: true,
                text: "No se pudo actualizar el catalogo.",
                value: 100
            });
            showErrorPopup(`Error actualizando catalogo: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            stopCatalogRefreshProgressTimer();
            catalogRefreshBusy = false;
            setCatalogBusyState(false);
            // volver a mostrar el selector de búsqueda cuando termine
            if (catalogSearchInput) catalogSearchInput.hidden = false;
            // ocultar la barra de progreso cuando la operación finalice
            setCatalogRefreshState({ visible: false, text: "", value: 0 });
        }
    }

    function openContextMenu(satelliteId, x, y) {
        contextTargetId = satelliteId;
        const menuWidth = 300;
        const menuHeight = 248;
        const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - menuWidth - 8));
        const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuHeight - 8));

        const layerType = typeof getLayerType === "function"
            ? String(getLayerType(satelliteId) || "SATELLITE").toUpperCase()
            : "SATELLITE";
        const isGroundStation = layerType === "GROUND_STATION";

        contextExplainBtn.hidden = isGroundStation;
        contextExportBtn.hidden = isGroundStation;
        contextUpdateStationBtn.hidden = !isGroundStation;
        contextToggleHeatMapBtn.hidden = true;
        contextVizBtn.hidden = isGroundStation;
        contextGroundTrackBtn.hidden = isGroundStation;
        if (!isGroundStation) {
            contextGroundTrackBtn.textContent = getGroundTrackVisible?.(satelliteId) ? "Ground Track Hide" : "Ground Track Show";
        }
        contextRenameBtn.hidden = isGroundStation;
        contextRemoveLayerBtn.hidden = false;

        if (isGroundStation && typeof getGroundStationParams === "function") {
            const params = getGroundStationParams(satelliteId) || {};
            const heatEnabled = params.heatmap_enabled === true;
            contextToggleHeatMapBtn.textContent = heatEnabled ? "Ocultar heat map" : "Mostrar heat map";
        }

        window.dispatchEvent(new CustomEvent("orbit:layer-context-menu", {
            detail: { left, top, groundStation: isGroundStation, groundTrackVisible: getGroundTrackVisible?.(satelliteId) === true }
        }));
    }

    async function resolveTle(satelliteId) {
        let tle = getObjectTle?.(satelliteId) || null;
        if (!tle && getObjectTleAsync) {
            tle = await getObjectTleAsync(satelliteId);
        }
        return tle;
    }

    function openInfoModalWithHtml(html) {
        window.dispatchEvent(new CustomEvent("orbit:tle-info", { detail: { html, title: uiText("satInfoTitle") } }));
    }

    async function openTleInfo(satelliteId, mode) {
        openInfoModalWithHtml(`<div class="tle-info-empty">Cargando informacion...</div>`);

        const sourceMeta = getCatalogEntryMeta?.(satelliteId) || null;
        const sourceFormat = String(sourceMeta?.sourceFormat || "TLE").toUpperCase();
        const telemetry = getObjectTelemetry?.(satelliteId) || null;

        if (sourceFormat === "OEM") {
            openInfoModalWithHtml(buildOemExplanationHtml(satelliteId, telemetry, sourceMeta));
            return;
        }

        const tleForOrbit = await resolveTle(satelliteId);
        const tleSummaryForOrbit = parseTleSummary(tleForOrbit);
        const orbitInfo = getOrbitInfoFromTleSummary(tleSummaryForOrbit, satelliteId);

        if (sourceFormat === "OMM") {
            openInfoModalWithHtml(buildOmmExplanationHtml(satelliteId, telemetry, sourceMeta, tleSummaryForOrbit));
            return;
        }

        if (mode === "details") {
            const details = await fetchCelestrakDetails(satelliteId) || await fetchWikipediaDetails(satelliteId);
            openInfoModalWithHtml(buildSatelliteDetailsHtml(satelliteId, details, orbitInfo));
            return;
        }

        const tle = tleForOrbit;
        const summary = parseTleSummary(tle);

        if (mode === "raw") {
            if (!summary) {
                openInfoModalWithHtml(`<div class="tle-info-empty">No hay TLE disponible para <strong>${escapeHtml(satelliteId)}</strong>.</div>`);
                return;
            }

            openInfoModalWithHtml(`
                <div class="tle-info-title">${escapeHtml(satelliteId)}</div>
                <section class="tle-info-section">
                    <h4>TLE crudo</h4>
                    <pre>${escapeHtml(summary.line1)}\n${escapeHtml(summary.line2)}</pre>
                </section>
            `);
            return;
        }

        openInfoModalWithHtml(buildTleExplanationHtml(satelliteId, summary));
    }

    function waitAndOpenCatalog() {
        catalogLoadingModal.classList.remove("open");
        openCatalogModal();
    }

    // Event listeners para el header (solo en modo legacy)
    if (header) {
        header.addEventListener("click", toggleSidebar);
        header.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleSidebar();
            }
        });
    }

    openCatalogBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openSidebar();
        if (addMenu.classList.contains("open")) {
            closeAddMenu();
            return;
        }
        openAddMenu(openCatalogBtn);
    });

    addSatelliteLayerBtn?.addEventListener("click", () => {
        closeAddMenu();
        if (typeof onRequestAddSatellite === "function") {
            onRequestAddSatellite();
        }
        waitAndOpenCatalog();
    });

    addGroundStationBtn?.addEventListener("click", () => {
        openGroundStationModal();
    });

    groundStationCloseBtn?.addEventListener("click", closeGroundStationModal);
    groundStationCreateBtn?.addEventListener("click", () => {
        submitGroundStation();
    });

    groundStationModal.addEventListener("click", (event) => {
        if (event.target === groundStationModal) {
            closeGroundStationModal();
        }
    });

    removeAllLayersHeaderBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const total = getLayerIds().length;
        if (!total) {
            return;
        }

        const ok = await askConfirmation({
            title: uiText("removeAllLayers"),
            message: uiText("removeAllLayersMsg").replace("{total}", total),
            confirmText: uiText("removeAllBtn"),
            cancelText: uiText("cancelBtn")
        });

        if (!ok) {
            return;
        }

        onRemoveAllLayers();
        selectedId = null;
        renderList();
        renderInfo();
        renderCatalogList();
    });

    toggleAllVisibilityBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (globalLayersVisible) {
            onHideAllObjects();
            setGlobalVisibility(false);
        } else {
            onShowAllObjects();
            setGlobalVisibility(true);
        }
        renderList();
        renderInfo();
    });

    catalogCloseBtn.addEventListener("click", closeCatalogModal);

    async function addImportedSatellitesToView(importedIds = []) {
        const uniqueIds = [...new Set(importedIds.map((id) => String(id || "").trim()).filter(Boolean))];
        const candidates = uniqueIds.filter((id) => !getObjectLayerActive(id));
        if (!candidates.length) {
            return { added: 0, skipped: 0, requested: uniqueIds.length };
        }

        const { availableSlots } = getLayerCapacity();
        if (availableSlots <= 0) {
            return { added: 0, skipped: candidates.length, requested: uniqueIds.length };
        }

        const idsToAdd = candidates.slice(0, availableSlots);
        const skipped = Math.max(0, candidates.length - idsToAdd.length);

        setCatalogBusyState(true, `Anadiendo importados... 0/${idsToAdd.length}`);
        await processInChunks(
            idsToAdd,
            (id) => onToggleObjectLayer(id, true),
            (done, total) => setCatalogBusyState(true, `Anadiendo importados... ${done}/${total}`)
        );

        if (idsToAdd.length > 0) {
            selectedId = idsToAdd[0];
            onSelectObject?.(selectedId);
        }

        return { added: idsToAdd.length, skipped, requested: uniqueIds.length };
    }

    async function importCatalogFile(file, { autoAddToView = false, announce = true } = {}) {
        if (!file) {
            if (announce) {
                showErrorPopup("No se detecto ningun fichero para importar.");
            }
            return;
        }

        const beforeFormats = getActiveFormatsSummary();

        try {
            const content = await file.text();
            setCatalogBusyState(true, "Importando catalogo...");
            const response = await fetch("/api/catalog/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileName: file.name, content, merge: true })
            });
            const payload = await response.json().catch(() => ({}));
            const isOemNoTleError =
                file.name.toLowerCase().endsWith(".oem")
                && String(payload?.error || "").includes("OEM no contiene TLE embebido");

            if ((!response.ok || payload?.ok === false) && isOemNoTleError && typeof onImportOemEphemeris === "function") {
                const importedTrack = onImportOemEphemeris(content, file.name);
                const importedId = String(importedTrack?.id || "").trim();
                if (importedId) {
                    const aligned = onAlignToOemTimeDomain?.() === true;
                    if (beforeFormats.nonOem > 0) {
                        const msg = aligned
                            ? "Aviso: al mezclar OEM con TLE/OMM, la simulacion pasa al dominio temporal OEM y las orbitas no OEM se propagan en ese rango."
                            : "Aviso: se ha cargado OEM junto a TLE/OMM; el dominio temporal objetivo es OEM para propagacion. Revisa el rango temporal activo.";
                        showErrorPopup(msg);
                    }

                    const oemBounds = getLoadedOemTimeBounds?.() || null;
                    const activeIdsNow = Array.isArray(getLayerIds?.()) ? getLayerIds() : [];
                    const nonOemCandidates = activeIdsNow.filter((id) => getSourceFormatForId(id) !== "OEM");
                    await warnTemporalIncompatibilitiesWithOemRange(nonOemCandidates, oemBounds);

                    selectedId = importedId;
                    onSelectObject?.(selectedId);
                    renderList();
                    renderInfo();
                    renderCatalogList();
                    if (announce) {
                        showInfoPopup(`OEM importado como orbita temporal: ${importedId} (${importedTrack?.points || 0} muestras).`);
                    }
                    return;
                }
            }

            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }

            await onRefreshCatalog?.();
            clearCatalogMetaCache();
            renderCatalogList();
            renderList();
            renderInfo();

            const importedNames = Array.isArray(payload?.importedNames) ? payload.importedNames : [];
            const importedFormat = normalizeImportFormat(payload?.format);
            const renamedConflicts = Array.isArray(payload?.renamedConflicts) ? payload.renamedConflicts : [];
            let addResult = { added: 0, skipped: 0, requested: importedNames.length };
            if (autoAddToView && importedNames.length > 0) {
                addResult = await addImportedSatellitesToView(importedNames);
                renderList();
                renderInfo();
                renderCatalogList();
            }

            const oemBounds = getLoadedOemTimeBounds?.() || null;
            const hasOemDomainActive = Boolean(oemBounds);
            if (hasOemDomainActive && importedFormat !== "OEM") {
                const aligned = onAlignToOemTimeDomain?.() === true;
                const msg = aligned
                    ? "Aviso: hay OEM cargado; los nuevos TLE/OMM se propagan en el dominio temporal OEM."
                    : "Aviso: hay OEM cargado; revisa que la simulacion este en rango OEM para propagar TLE/OMM correctamente.";
                showErrorPopup(msg);
                await warnTemporalIncompatibilitiesWithOemRange(importedNames, oemBounds);
            }

            if (renamedConflicts.length > 0) {
                const sample = renamedConflicts.slice(0, 3)
                    .map((item) => `${item.importedName} -> ${item.existingName} (NORAD ${item.norad})`)
                    .join("; ");
                const suffix = renamedConflicts.length > 3 ? ` +${renamedConflicts.length - 3} mas` : "";
                showErrorPopup(`Aviso: ${renamedConflicts.length} entradas ya existian con otro nombre y se mantuvo el nombre de catalogo. ${sample}${suffix}`);
            }

            if (announce) {
                const importedCount = Number(payload?.imported) || importedNames.length;
                if (autoAddToView) {
                    showInfoPopup(`Importado ${file.name}: ${importedCount} entradas. Anadidas a vista: ${addResult.added}${addResult.skipped > 0 ? `, omitidas por limite: ${addResult.skipped}` : ""}.`);
                } else {
                    showInfoPopup(`Importado ${file.name}: ${importedCount} entradas al catalogo.`);
                }
            }
        } catch (error) {
            showErrorPopup(`No se pudo importar ${file?.name || "fichero"}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (catalogImportFileInput) {
                catalogImportFileInput.value = "";
            }
            setCatalogBusyState(false, "");
        }
    }

    catalogImportBtn.addEventListener("click", () => {
        catalogImportFileInput?.click();
    });

    catalogImportFileInput?.addEventListener("change", async (event) => {
        const file = event?.target?.files?.[0];
        await importCatalogFile(file, { autoAddToView: false, announce: true });
    });

    catalogModal.addEventListener("dragover", (event) => {
        event.preventDefault();
    });

    catalogModal.addEventListener("drop", async (event) => {
        event.preventDefault();
        const file = event?.dataTransfer?.files?.[0];
        await importCatalogFile(file, { autoAddToView: false, announce: true });
    });

    const onGlobalFileDragEnter = (event) => {
        if (!isFileDragEvent(event)) {
            return;
        }
        event.preventDefault();
        globalFileDragDepth += 1;
        setGlobalDropOverlayVisible(true);
    };

    const onGlobalFileDragLeave = (event) => {
        if (!isFileDragEvent(event)) {
            return;
        }
        event.preventDefault();
        globalFileDragDepth = Math.max(0, globalFileDragDepth - 1);
        if (globalFileDragDepth === 0) {
            setGlobalDropOverlayVisible(false);
        }
    };

    const onGlobalFileDragOver = (event) => {
        if (!isFileDragEvent(event)) {
            return;
        }
        event.preventDefault();
        if (event?.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
        setGlobalDropOverlayVisible(true);
    };

    const onGlobalFileDrop = async (event) => {
        if (!isFileDragEvent(event)) {
            return;
        }
        event.preventDefault();
        globalFileDragDepth = 0;
        setGlobalDropOverlayVisible(false);

        if (catalogModal.contains(event.target)) {
            return;
        }

        const files = event?.dataTransfer?.files;
        if (!files || files.length === 0) {
            showErrorPopup("No se detectaron archivos en el arrastre.");
            return;
        }
        const file = files[0];
        await importCatalogFile(file, { autoAddToView: true, announce: true });
    };

    document.addEventListener("dragenter", onGlobalFileDragEnter, true);
    document.addEventListener("dragleave", onGlobalFileDragLeave, true);
    document.addEventListener("dragover", onGlobalFileDragOver, true);
    document.addEventListener("drop", onGlobalFileDrop, true);

    catalogFiltersBtn.addEventListener("click", openCatalogFilterModal);
    catalogModal.addEventListener("click", (event) => {
        if (event.target === catalogModal) {
            closeCatalogModal();
        }
    });

    catalogFilterCloseBtn.addEventListener("click", closeCatalogFilterModal);
    catalogFilterModal.addEventListener("click", (event) => {
        if (event.target === catalogFilterModal) {
            closeCatalogFilterModal();
        }
    });

    contextExplainBtn.addEventListener("click", () => {
        if (!contextTargetId) {
            return;
        }
        const id = contextTargetId;
        closeContextMenu();
        openTleInfo(id, "explain");
    });

    contextVizBtn.addEventListener("click", () => {
        if (!contextTargetId) {
            return;
        }
        const id = contextTargetId;
        closeContextMenu();
        onOpenVisualizationOptions?.(id);
    });

    addFolderBtn?.addEventListener("click", async () => {
        closeAddMenu();
        const name = await requestFolderName({ title: "Nueva carpeta", label: "Nombre de la carpeta" });
        if (layerTree.createFolder(name)) renderList();
    });

    contextGroundTrackBtn.addEventListener("click", () => {
        if (!contextTargetId) return;
        const id = contextTargetId;
        closeContextMenu();
        onToggleGroundTrack?.(id);
    });

    contextRemoveLayerBtn.addEventListener("click", () => {
        if (!contextTargetId) return;
        const id = contextTargetId;
        closeContextMenu();
        onToggleObjectLayer(id, false);
        if (selectedId === id) selectedId = null;
        renderList(); renderInfo(); renderCatalogList();
    });

    contextUpdateStationBtn.addEventListener("click", () => {
        if (!contextTargetId) {
            return;
        }
        const id = contextTargetId;
        closeContextMenu();
        openGroundStationModal(id);
    });

    contextToggleHeatMapBtn.addEventListener("click", async () => {
        if (!contextTargetId) {
            return;
        }
        const id = contextTargetId;
        closeContextMenu();

        if (typeof onRequestToggleGroundStationHeatMap !== "function") {
            showErrorPopup("El cambio de heat map no esta disponible en este contexto.");
            return;
        }

        const current = typeof getGroundStationParams === "function"
            ? getGroundStationParams(id)
            : null;
        const enabledNow = current?.heatmap_enabled === true;
        const updated = await onRequestToggleGroundStationHeatMap(id, !enabledNow);
        if (!updated) {
            showErrorPopup("No se pudo cambiar el estado del heat map.");
            return;
        }

        renderList();
        renderInfo();
        showInfoPopup(!enabledNow ? "Heat map activado." : "Heat map ocultado.");
    });

    contextExportBtn.addEventListener("click", () => {
        if (!contextTargetId) {
            return;
        }
        const id = contextTargetId;
        closeContextMenu();
        openExportModal(id);
    });

    contextRenameBtn.addEventListener("click", async () => {
        if (!contextTargetId) {
            return;
        }
        const id = contextTargetId;
        closeContextMenu();

        const currentName = typeof getLayerDisplayName === "function" ? getLayerDisplayName(id) : id;
        const nextName = window.prompt("Nuevo nombre de capa", String(currentName || "").trim());
        if (nextName === null) {
            return;
        }

        const trimmed = String(nextName || "").trim();
        if (!trimmed) {
            showErrorPopup("El nombre no puede quedar vacio.");
            return;
        }

        if (typeof onRequestRenameLayer !== "function") {
            showErrorPopup("El renombrado no esta disponible para esta capa.");
            return;
        }

        const renamed = await onRequestRenameLayer(id, trimmed);
        if (!renamed) {
            showErrorPopup("No se pudo renombrar la capa.");
            return;
        }

        renderList();
        renderInfo();
        renderCatalogList();
    });

    window.addEventListener("orbit:layer-context-action", (event) => {
        const actionButtons = {
            explain: contextExplainBtn,
            viz: contextVizBtn,
            ground: contextGroundTrackBtn,
            remove: contextRemoveLayerBtn,
            station: contextUpdateStationBtn,
            export: contextExportBtn,
            rename: contextRenameBtn
        };
        actionButtons[event.detail]?.click();
    });

    catalogExportCloseBtn.addEventListener("click", closeExportModal);

    exportModal.addEventListener("click", (event) => {
        if (event.target === exportModal) {
            closeExportModal();
        }
    });

    window.addEventListener("orbit:export-action", (event) => {
        const buttons = { tle: exportTleBtn, "omm-json": exportOmmJsonBtn, "omm-xml": exportOmmXmlBtn, oem: exportOemBtn, ephemeris: exportEphemerisBtn };
        if (event.detail?.type === "close") { closeExportModal(); return; }
        if (event.detail?.type === "ephemeris") {
            exportEphemStartInput.value = event.detail.start || exportEphemStartInput.value;
            exportEphemEndInput.value = event.detail.end || exportEphemEndInput.value;
            exportEphemStepInput.value = event.detail.step || exportEphemStepInput.value;
            exportEphemFormatSelect.value = event.detail.format || exportEphemFormatSelect.value;
        }
        buttons[event.detail?.type]?.click();
    });

    exportTleBtn.addEventListener("click", async () => {
        const id = String(catalogExportTarget.textContent || "").trim();
        if (!id) return;
        try {
            await downloadFromUrl(`/api/export/tle/${encodeURIComponent(id)}`, `${id}.tle`);
            showInfoPopup("Exportacion TLE completada.");
        } catch (error) {
            showErrorPopup(`No se pudo exportar TLE: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    exportOmmJsonBtn.addEventListener("click", async () => {
        const id = String(catalogExportTarget.textContent || "").trim();
        if (!id) return;
        try {
            await downloadFromUrl(`/api/export/omm/${encodeURIComponent(id)}?format=json`, `${id}.omm.json`);
            showInfoPopup("Exportacion OMM (JSON) completada.");
        } catch (error) {
            showErrorPopup(`No se pudo exportar OMM (JSON): ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    exportOmmXmlBtn.addEventListener("click", async () => {
        const id = String(catalogExportTarget.textContent || "").trim();
        if (!id) return;
        try {
            await downloadFromUrl(`/api/export/omm/${encodeURIComponent(id)}?format=xml`, `${id}.omm.xml`);
            showInfoPopup("Exportacion OMM (XML) completada.");
        } catch (error) {
            showErrorPopup(`No se pudo exportar OMM (XML): ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    exportOemBtn.addEventListener("click", async () => {
        const id = String(catalogExportTarget.textContent || "").trim();
        if (!id) return;
        try {
            await downloadFromUrl(`/api/export/oem/${encodeURIComponent(id)}`, `${id}.oem`);
            showInfoPopup("Exportacion OEM completada.");
        } catch (error) {
            showErrorPopup(`No se pudo exportar OEM: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    exportEphemerisBtn.addEventListener("click", async () => {
        const id = String(catalogExportTarget.textContent || "").trim();
        if (!id) return;

        const t0Raw = String(exportEphemStartInput.value || "").trim();
        const t1Raw = String(exportEphemEndInput.value || "").trim();
        const dt = Number(exportEphemStepInput.value || 10);
        const format = String(exportEphemFormatSelect.value || "csv").trim().toLowerCase();
        const propagator = String(exportEphemPropagatorSelect.value || "sgp4").trim().toLowerCase();

        if (!t0Raw || !t1Raw || !Number.isFinite(dt) || dt <= 0) {
            showErrorPopup("Revisa fechas e intervalo para exportar efemerides.");
            return;
        }

        const t0Iso = new Date(t0Raw).toISOString();
        const t1Iso = new Date(t1Raw).toISOString();
        const params = new URLSearchParams({
            t0: t0Iso,
            t1: t1Iso,
            dt: String(dt),
            format,
            propagator,
            sourceFormat: exportSourceFormat
        });

        try {
            await downloadFromUrl(`/api/export/ephemeris/${encodeURIComponent(id)}?${params.toString()}`, `${id}-ephemeris.${format}`);
            showInfoPopup("Exportacion de efemerides completada.");
        } catch (error) {
            showErrorPopup(`No se pudo exportar efemerides: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    document.addEventListener("click", (event) => {
        if (!contextMenu.classList.contains("open")) {
            if (addMenu.classList.contains("open") && !addMenu.contains(event.target) && event.target !== openCatalogBtn) {
                closeAddMenu();
            }
            return;
        }
        if (contextMenu.contains(event.target)) {
            return;
        }
        closeContextMenu();
        if (addMenu.classList.contains("open") && !addMenu.contains(event.target) && event.target !== openCatalogBtn) {
            closeAddMenu();
        }
    });

    searchInput.addEventListener("input", () => {
        if (searchInput.dataset.globalSearchMode === "true") {
            layerFilterText = "";
            return;
        }
        layerFilterText = searchInput.value || "";
        renderList();
    });

    window.addEventListener("orbit:layer-search-options", (event) => {
        layerSearchOptions = { ...layerSearchOptions, ...(event.detail || {}) };
        renderList();
    });

    catalogSearchInput.addEventListener("input", () => {
        if (catalogSearchDebounce) {
            clearTimeout(catalogSearchDebounce);
        }
        catalogSearchDebounce = setTimeout(() => {
            applyCatalogFilters({ name: catalogSearchInput.value || "" });
        }, 120);
    });

    catalogFilterNameInput.addEventListener("input", () => {
        if (catalogSearchDebounce) {
            clearTimeout(catalogSearchDebounce);
        }
        catalogSearchDebounce = setTimeout(() => {
            applyCatalogFilters({ name: catalogFilterNameInput.value || "" });
        }, 120);
    });

    catalogOrbitFilter.addEventListener("change", () => {
        applyCatalogFilters({ orbitKind: catalogOrbitFilter.value || "" });
    });

    catalogMissionFilter.addEventListener("change", () => {
        applyCatalogFilters({ mission: catalogMissionFilter.value || "" });
    });

    catalogSourceFormatFilter.addEventListener("change", () => {
        applyCatalogFilters({ sourceFormat: catalogSourceFormatFilter.value || "" });
    });

    catalogDecayOnlyFilter.addEventListener("change", () => {
        applyCatalogFilters({ decayOnly: catalogDecayOnlyFilter.checked === true });
    });

    catalogFilterClearBtn.addEventListener("click", () => {
        applyCatalogFilters({
            name: "",
            orbitKind: "",
            mission: "",
            sourceFormat: "",
            decayOnly: false
        });
    });

    catalogFilterSummary.addEventListener("click", (event) => {
        const removeBtn = event.target.closest(".catalog-filter-chip-remove");
        if (!removeBtn) {
            return;
        }

        const key = String(removeBtn.dataset.filterKey || "");
        if (!key) {
            return;
        }

        if (key === "decayOnly") {
            applyCatalogFilters({ decayOnly: false });
        } else {
            applyCatalogFilters({ [key]: "" });
        }
    });

    catalogPrevPageBtn.addEventListener("click", () => {
        if (catalogCurrentPage <= 1 || catalogLoadingPage) {
            return;
        }
        requestCatalogPage(catalogCurrentPage - 1);
    });

    catalogNextPageBtn.addEventListener("click", () => {
        if (catalogCurrentPage >= catalogTotalPages || catalogLoadingPage) {
            return;
        }
        requestCatalogPage(catalogCurrentPage + 1);
    });

    catalogAddSelectedBtn.addEventListener("click", async () => {
        if (catalogBusy) {
            return;
        }

        const ids = [...selectedCatalogIds];
        if (!ids.length) {
            return;
        }

        const idsInactive = ids.filter((id) => !getObjectLayerActive(id));
        const idsAlreadyActive = ids.filter((id) => getObjectLayerActive(id));

        const { maxLayers, availableSlots } = getLayerCapacity();
        if (availableSlots <= 0) {
            showErrorPopup(`Has alcanzado el limite de ${maxLayers} capas activas. Quita alguna capa antes de anadir mas.`);
            return;
        }

        let allowDuplicates = false;
        if (idsAlreadyActive.length > 0) {
            allowDuplicates = await askConfirmation({
                title: "Capas ya activas",
                message: `${idsAlreadyActive.length} capas ya estan activas. ¿Quieres añadir copias (por ejemplo ISS (2))?`,
                confirmText: "Duplicar",
                cancelText: "No duplicar"
            });
        }

        const pending = [...idsInactive];
        if (allowDuplicates && typeof onRequestDuplicateLayer === "function") {
            pending.push(...idsAlreadyActive);
        }

        if (!pending.length) {
            return;
        }

        const idsToAdd = pending.slice(0, availableSlots);
        const skippedCount = Math.max(0, pending.length - idsToAdd.length);

        const ok = await askConfirmation({
            title: uiText("confirmInclusion"),
            message: skippedCount > 0
                ? uiText("includeElementsMsg").replace("{count}", idsToAdd.length).replace("{skipped}", skippedCount).replace("{maxLayers}", maxLayers)
                : uiText("includeElementsMsgNoSkip").replace("{count}", idsToAdd.length),
            confirmText: uiText("includeBtn"),
            cancelText: uiText("cancelBtn")
        });

        if (!ok) {
            return;
        }

        setCatalogBusyState(true, `${uiText("addingLayers")} 0/${idsToAdd.length}`);

        let firstAddedId = null;
        processInChunks(
            idsToAdd,
            (id) => {
                if (getObjectLayerActive(id) && typeof onRequestDuplicateLayer === "function") {
                    const duplicated = onRequestDuplicateLayer(id);
                    if (!firstAddedId && duplicated) {
                        firstAddedId = duplicated;
                    }
                    return;
                }
                onToggleObjectLayer(id, true);
                if (!firstAddedId) {
                    firstAddedId = id;
                }
            },
            (done, total) => setCatalogBusyState(true, `${uiText("addingLayers")} ${done}/${total}`)
        ).then(() => {
            selectedId = firstAddedId;
            onSelectObject?.(selectedId);
            selectedCatalogIds.clear();
            catalogAnchorIndex = null;
            layerFilterText = "";
            searchInput.value = "";
            setCatalogBusyState(false);
            renderList();
            renderInfo();
            renderCatalogList();
            closeCatalogModal();
            if (skippedCount > 0) {
                showInfoPopup(uiText("layersAdded").replace("{count}", idsToAdd.length).replace("{skipped}", skippedCount).replace("{maxLayers}", maxLayers));
            }
        });
    });

    window.addEventListener("orbit:catalog-action", (event) => {
        const action = event.detail || {};
        if (action.type === "close") { closeCatalogModal(); return; }
        if (action.type === "search") { applyCatalogFilters({ name: String(action.value || "") }); return; }
        if (action.type === "filter") { applyCatalogFilters({ orbitKind: String(action.orbitKind || "") }); return; }
        if (action.type === "filters") { window.dispatchEvent(new CustomEvent("orbit:catalog-filters-open", { detail: { ...catalogFilterState } })); return; }
        if (action.type === "filters-apply") { applyCatalogFilters(action.filters || {}); return; }
        if (action.type === "page") { requestCatalogPage(action.page); return; }
        if (action.type === "refresh") { catalogRefreshBtn.click(); return; }
        if (action.type === "import" && action.file instanceof File) { importCatalogFile(action.file, { autoAddToView: false, announce: true }); return; }
        if (action.type === "select-all") { catalogSelectAllBtn.click(); return; }
        if (action.type === "include") { catalogAddSelectedBtn.click(); return; }
        if (action.type === "info" && action.id) { openTleInfo(action.id, "explain"); return; }
        if (action.type === "toggle" && action.id && !catalogBusy && !getObjectLayerActive(action.id)) {
            const index = lastRenderedCatalogIds.indexOf(action.id);
            if (action.range && catalogAnchorIndex !== null && index >= 0) {
                const from = Math.min(catalogAnchorIndex, index);
                const to = Math.max(catalogAnchorIndex, index);
                if (!action.multi) selectedCatalogIds.clear();
                for (let i = from; i <= to; i += 1) selectedCatalogIds.add(lastRenderedCatalogIds[i]);
            } else if (action.multi) {
                if (selectedCatalogIds.has(action.id)) selectedCatalogIds.delete(action.id); else selectedCatalogIds.add(action.id);
                catalogAnchorIndex = index;
            } else {
                if (selectedCatalogIds.has(action.id)) selectedCatalogIds.delete(action.id); else selectedCatalogIds.add(action.id);
                catalogAnchorIndex = index;
            }
            renderCatalogRows(lastRenderedCatalogIds, catalogRenderToken);
        }
    });

    catalogRefreshBtn.addEventListener("click", () => {
        refreshCatalogFromCelestrak();
    });

    catalogSelectAllBtn.addEventListener("click", async () => {
        if (catalogBusy) {
            return;
        }

        setCatalogBusyState(true, "Buscando resultados en todas las paginas...");

        let filteredIds = [];
        try {
            filteredIds = await fetchAllFilteredCatalogIds((loaded, total) => {
                const safeTotal = Math.max(total || 0, loaded || 0);
                setCatalogBusyState(true, `Cargando candidatos... ${loaded}/${safeTotal}`);
            });
        } catch (error) {
            setCatalogBusyState(false);
            showErrorPopup(`No se pudo completar 'Seleccionar todo': ${error instanceof Error ? error.message : String(error)}`);
            return;
        }

        const toSelect = filteredIds.filter((id) => !selectedCatalogIds.has(id));

        if (!toSelect.length) {
            setCatalogBusyState(false);
            return;
        }

        const ok = await askConfirmation({
            title: "Seleccionar Muchos Objetos",
            message: `Vas a seleccionar ${toSelect.length} objetos del catalogo. Si luego los anades, puede tardar unos segundos.`,
            confirmText: "Seleccionar",
            cancelText: "Cancelar"
        });

        if (!ok) {
            setCatalogBusyState(false);
            return;
        }

        setCatalogBusyState(true, `Seleccionando... 0/${toSelect.length}`);

        processInChunks(
            toSelect,
            (id) => selectedCatalogIds.add(id),
            (done, total) => setCatalogBusyState(true, `Seleccionando... ${done}/${total}`)
        ).then(() => {
            setCatalogBusyState(false);
            renderCatalogList();
        });
    });

    async function fetchAllFilteredCatalogIds(onProgress) {
        if (!fetchCatalogPage) {
            return [];
        }

        const allIds = [];
        const uniqueIds = new Set();
        const limit = CATALOG_PAGE_SIZE;
        let offset = 0;
        let total = null;

        while (true) {
            const result = await fetchCatalogPage({
                offset,
                limit,
                search: catalogFilterState.name,
                orbitKind: catalogFilterState.orbitKind,
                mission: catalogFilterState.mission,
                sourceFormat: catalogFilterState.sourceFormat,
                decayOnly: catalogFilterState.decayOnly
            });

            const pageIds = Array.isArray(result?.ids) ? result.ids : [];
            const reportedTotal = Number(result?.total);
            if (Number.isFinite(reportedTotal) && reportedTotal >= 0) {
                total = Math.max(total ?? 0, Math.floor(reportedTotal));
            }

            for (const id of pageIds) {
                if (!uniqueIds.has(id)) {
                    uniqueIds.add(id);
                    allIds.push(id);
                }
            }

            onProgress?.(allIds.length, total ?? allIds.length);

            if (!pageIds.length) {
                break;
            }

            offset += pageIds.length;

            if (total !== null && offset >= total) {
                break;
            }
        }

        return allIds;
    }

    function processInChunks(items, processItem, onProgress) {
        return new Promise((resolve) => {
            let index = 0;
            const total = items.length;

            const next = () => {
                const end = Math.min(index + BULK_PROCESS_CHUNK, total);
                while (index < end) {
                    processItem(items[index]);
                    index += 1;
                }

                onProgress?.(index, total);

                if (index < total) {
                    requestAnimationFrame(next);
                    return;
                }

                resolve();
            };

            requestAnimationFrame(next);
        });
    }

    function setCatalogBusyState(isBusy, text = "") {
        catalogBusy = isBusy;
        catalogAddSelectedBtn.disabled = isBusy || selectedCatalogIds.size === 0;
        catalogSelectAllBtn.disabled = isBusy;
        catalogRefreshBtn.disabled = isBusy;
        catalogImportBtn.disabled = isBusy;
        catalogFiltersBtn.disabled = isBusy;
        catalogCloseBtn.disabled = isBusy;
        catalogSearchInput.disabled = isBusy;
        catalogFilterNameInput.disabled = isBusy;
        catalogOrbitFilter.disabled = isBusy;
        catalogMissionFilter.disabled = isBusy;
        catalogSourceFormatFilter.disabled = isBusy;
        catalogDecayOnlyFilter.disabled = isBusy;
        catalogFilterClearBtn.disabled = isBusy;
        catalogProgress.textContent = text;
    }

    function getRenderableLayerIds() {
        const directIds = getLayerIds();
        if (directIds.length > 1) {
            return directIds;
        }

        // Fallback defensivo: reconstruir activos consultando catálogo + estado real.
        // Evita que el panel izquierdo se quede con 1 elemento por desincronización de caché.
        try {
            const rebuilt = getCatalogIds().filter((id) => getObjectLayerActive(id));
            if (rebuilt.length > directIds.length) {
                return rebuilt;
            }
        } catch {
            // mantener resultado directo si el fallback falla
        }

        return directIds;
    }

    function renderList() {
        const ids = getRenderableLayerIds();
        if (pendingFolderAssignment) {
            const addedIds = ids.filter((id) => !pendingFolderAssignment.knownIds.has(id));
            if (addedIds.length) {
                addedIds.forEach((id) => layerTree.move(id, pendingFolderAssignment.folderId));
                pendingFolderAssignment = null;
            }
        }
        // Destructive controls are only useful when there is something to remove.
        removeAllLayersHeaderBtn.hidden = getLayerIds().length === 0;
        const activeFilterText = String(searchInput?.value || layerFilterText || "").trim();
        const tree = layerTree.snapshot(ids);
        const filteringLayers = activeFilterText.length > 0;
        const matchLayerSearch = (text) => {
            if (!filteringLayers) return true;
            const source = String(text || "");
            const flags = layerSearchOptions.matchCase ? "" : "i";
            try {
                if (layerSearchOptions.regex) return new RegExp(activeFilterText, flags).test(source);
                const escaped = activeFilterText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                if (layerSearchOptions.wholeWord) return new RegExp(`\\b${escaped}\\b`, flags).test(source);
                return layerSearchOptions.matchCase
                    ? source.includes(activeFilterText)
                    : source.toLowerCase().includes(activeFilterText.toLowerCase());
            } catch {
                return false;
            }
        };
        const matchingFolderIds = new Set(tree.folders
            .filter((folder) => matchLayerSearch(folder.name))
            .map((folder) => folder.id));
        const folderMatchesOrContainsMatch = (folderId) => {
            let currentId = folderId;
            while (currentId) {
                if (matchingFolderIds.has(currentId)) return true;
                currentId = tree.folders.find((folder) => folder.id === currentId)?.parentId || null;
            }
            return false;
        };
        const filtered = ids.filter((id) => {
            const displayName = typeof getLayerDisplayName === "function"
                ? String(getLayerDisplayName(id) || id)
                : String(id || "");
            return !filteringLayers
                || matchLayerSearch(displayName)
                || matchLayerSearch(id)
                || folderMatchesOrContainsMatch(tree.layerParents[id]);
        });
        const visibleFolderIds = new Set();
        const addFolderWithParents = (folderId) => {
            let currentId = folderId;
            while (currentId) {
                visibleFolderIds.add(currentId);
                currentId = tree.folders.find((folder) => folder.id === currentId)?.parentId || null;
            }
        };
        if (filteringLayers) {
            matchingFolderIds.forEach(addFolderWithParents);
            filtered.forEach((id) => addFolderWithParents(tree.layerParents[id]));
        }

        listRoot.innerHTML = "";
        const containers = new Map([[null, listRoot]]);
        listRoot.addEventListener("dragover", (event) => event.preventDefault());
        listRoot.addEventListener("drop", (event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData("text/plain");
            if (layerTree.move(id, null)) renderList();
        });
        const renderFolder = (folder, parentContainer) => {
            if (filteringLayers && !visibleFolderIds.has(folder.id)) return;
            const group = document.createElement("section");
            group.className = "layer-tree-folder";
            const header = document.createElement("button");
            header.type = "button";
            header.className = "layer-tree-folder-header";
            header.innerHTML = `<span class="layer-tree-chevron">${folder.expanded ? "▾" : "▸"}</span><span class="layer-tree-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.2a2.2 2.2 0 0 1 2.2-2.2h3.2l1.9 2.3h6.2a2.2 2.2 0 0 1 2.2 2.2v6.9a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2z"/><path d="M3.8 11.1h16.4"/></svg></span><span>${folder.name}</span>`;
            header.draggable = true;
            header.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", folder.id); event.dataTransfer.effectAllowed = "move"; });
            header.addEventListener("dragover", (event) => { event.preventDefault(); event.stopPropagation(); });
            header.addEventListener("drop", (event) => {
                event.preventDefault(); event.stopPropagation();
                const id = event.dataTransfer.getData("text/plain");
                if (layerTree.move(id, folder.id)) renderList();
            });
            header.addEventListener("click", () => { layerTree.toggle(folder.id); renderList(); });
            header.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                openFolderContextMenu(folder, event.clientX, event.clientY);
            });
            group.appendChild(header);
            const body = document.createElement("div");
            body.hidden = filteringLayers ? false : !folder.expanded;
            body.className = "layer-tree-folder-body";
            body.addEventListener("dragover", (event) => { event.preventDefault(); event.stopPropagation(); });
            body.addEventListener("drop", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = event.dataTransfer.getData("text/plain");
                if (layerTree.move(id, folder.id)) renderList();
            });
            group.appendChild(body); parentContainer.appendChild(group); containers.set(folder.id, body);
            tree.folders.filter((item) => item.parentId === folder.id).forEach((child) => renderFolder(child, body));
        };
        tree.folders.filter((item) => !item.parentId).forEach((folder) => renderFolder(folder, listRoot));
        for (const id of filtered) {
            const rowEl = document.createElement("div");
            rowEl.className = `object-list-row${id === selectedId ? " active" : ""}`;
            rowEl.draggable = true;
            rowEl.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", id));

            const item = document.createElement("button");
            item.type = "button";
            item.draggable = true;
            item.className = `object-list-item${id === selectedId ? " active" : ""}`;
            item.textContent = "";
            const displayName = typeof getLayerDisplayName === "function"
                ? String(getLayerDisplayName(id) || id)
                : String(id || "");
            item.appendChild(document.createTextNode(displayName));

            const layerType = typeof getLayerType === "function"
                ? String(getLayerType(id) || "").toUpperCase()
                : "";

            if (layerType) {
                const typeBadge = document.createElement("span");
                typeBadge.className = "catalog-format-badge";
                typeBadge.textContent = layerType === "GROUND_STATION" ? "GST" : (layerType === "POINT" ? "POINT" : "SAT");
                typeBadge.title = `Tipo: ${typeBadge.textContent}`;
                item.appendChild(document.createTextNode(" "));
                item.appendChild(typeBadge);
            }

            const listEntryMeta = getCatalogEntryMeta?.(id) || null;
            if (listEntryMeta?.sourceFormat) {
                const formatBadge = document.createElement("span");
                formatBadge.className = "catalog-format-badge";
                formatBadge.textContent = String(listEntryMeta.sourceFormat || "TLE").toUpperCase();
                formatBadge.title = `Formato: ${formatBadge.textContent}`;
                item.appendChild(document.createTextNode(" "));
                item.appendChild(formatBadge);
            }
            item.addEventListener("click", () => {
                selectedId = id;
                onSelectObject?.(selectedId);
                renderList();
                renderInfo();
            });
            item.addEventListener("dragstart", (event) => {
                event.stopPropagation();
                event.dataTransfer.setData("text/plain", id);
                event.dataTransfer.effectAllowed = "move";
            });
            item.addEventListener("dblclick", () => {
                selectedId = id;
                onSelectObject?.(selectedId);
                renderList();
                renderInfo();
                onFocusObject(selectedId);
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "object-remove-layer-btn";
            removeBtn.title = "Quitar capa";
            removeBtn.setAttribute("aria-label", "Quitar capa");
            removeBtn.textContent = "✕";
            removeBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                onToggleObjectLayer(id, false);
                if (selectedId === id) {
                    selectedId = null;
                }
                renderList();
                renderInfo();
                renderCatalogList();
            });

            const isVisible = getObjectVisibility(id);
            const eyeBtn = document.createElement("button");
            eyeBtn.type = "button";
            eyeBtn.className = `object-visibility-btn${isVisible ? "" : " is-hidden"}`;
            eyeBtn.title = isVisible ? "Ocultar satelite y orbitas" : "Mostrar satelite y orbitas";
            eyeBtn.setAttribute("aria-label", eyeBtn.title);
            eyeBtn.textContent = isVisible ? "👁" : "🙈";
            eyeBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                const nextVisible = !getObjectVisibility(id);
                onToggleObjectVisibility(id, nextVisible);
                renderList();
                renderInfo();
            });

            rowEl.appendChild(item);
            rowEl.appendChild(removeBtn);
            rowEl.appendChild(eyeBtn);

            rowEl.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                openContextMenu(id, event.clientX, event.clientY);
            });

            (containers.get(tree.layerParents[id]) || listRoot).appendChild(rowEl);
        }

        // Última fila: acción "+" con aspecto de satélite que abre el catálogo.
        const addRow = document.createElement("div");
        addRow.className = "object-list-row object-list-row-add";
        const addItem = document.createElement("button");
        addItem.type = "button";
        addItem.className = "object-list-item object-list-add-item";
        addItem.title = "Añadir capa";
        addItem.setAttribute("aria-label", "Añadir capa");
        addItem.innerHTML = `<span class="object-list-add-plus">+</span><span>Añadir capa</span>`;
        addItem.addEventListener("click", (event) => {
            event.stopPropagation();
            openAddMenu(addItem);
        });
        addRow.appendChild(addItem);
        listRoot.appendChild(addRow);

        // Empty folders do not need a vertical guide; the guide is reserved
        // for folders that actually contain a layer or a subfolder.
        listRoot.querySelectorAll(".layer-tree-folder-body").forEach((body) => {
            body.classList.toggle("is-empty", body.children.length === 0);
        });

        if (selectedId && !ids.includes(selectedId)) {
            selectedId = null;
            renderInfo();
        }

        // React owns the visible tree. The legacy list remains a hidden
        // compatibility surface while the catalog is migrated incrementally.
        listRoot.hidden = true;
        window.dispatchEvent(new CustomEvent("orbit:layer-tree-state", {
            detail: {
                tree: filteringLayers ? { ...tree, folders: tree.folders.filter((folder) => visibleFolderIds.has(folder.id)) } : tree,
                layers: filtered.map((id) => {
                    const meta = getCatalogEntryMeta?.(id) || null;
                    const layerType = String(getLayerType?.(id) || "").toUpperCase();
                    return {
                        id,
                        name: String(getLayerDisplayName?.(id) || id),
                        type: layerType === "GROUND_STATION" ? "GST" : (layerType === "POINT" ? "POINT" : "SAT"),
                        format: meta?.sourceFormat ? String(meta.sourceFormat).toUpperCase() : "",
                        visible: getObjectVisibility(id),
                        selected: id === selectedId
                    };
                })
            }
        }));
        syncGlobalVisibilityFromLayers(ids);
    }

    window.addEventListener("orbit:ground-station-submit", (event) => {
        const values = event.detail || {};
        const inputs = { name: gsNameInput, latitude_deg: gsLatInput, longitude_deg: gsLonInput, altitude_m: gsAltInput, min_elevation_deg: gsMaskInput, frequency_mhz: gsFreqInput, tx_power_dbm: gsTxPowerInput, tx_gain_dbi: gsTxGainInput, rx_gain_dbi: gsRxGainInput, coverage_radius_km: gsCoverageRadiusInput, point_size_px: gsPointSizeInput, point_symbol: gsPointSymbolInput, point_color: gsPointColorInput, heatmap_density: gsHeatDensityInput };
        Object.entries(inputs).forEach(([key, input]) => { if (input && values[key] !== undefined) input.value = values[key]; });
        gsCoverageVisibleInput.checked = values.coverage_visible !== false;
        gsHeatEnabledInput.checked = values.heatmap_enabled === true;
        submitGroundStation();
    });

    window.addEventListener("orbit:layer-tree-action", (event) => {
        const action = event.detail || {};
        if (action.type === "select" && action.id) {
            selectedId = action.id;
            onSelectObject?.(selectedId);
            renderList(); renderInfo();
        }
        if (action.type === "focus" && action.id) {
            selectedId = action.id;
            onSelectObject?.(selectedId);
            onFocusObject(selectedId);
            renderList(); renderInfo();
        }
        if (action.type === "visibility" && action.id) {
            onToggleObjectVisibility(action.id, action.visible === true);
            renderList(); renderInfo();
        }
        if (action.type === "remove" && action.id) {
            onToggleObjectLayer(action.id, false);
            if (selectedId === action.id) selectedId = null;
            renderList(); renderInfo(); renderCatalogList();
        }
        if (action.type === "toggle-folder" && action.id) {
            layerTree.toggle(action.id);
            renderList();
        }
        if (action.type === "create-folder") {
            requestFolderName({ title: action.title || "Nueva carpeta", label: action.label || "Nombre de la carpeta" }).then((name) => {
                if (name && layerTree.createFolder(name, action.parentId || null)) renderList();
            });
        }
        if (action.type === "rename-folder" && action.id) {
            requestFolderName({ title: "Renombrar carpeta", label: "Nombre de la carpeta", initialValue: action.name || "" }).then((name) => {
                if (name && layerTree.renameFolder(action.id, name)) renderList();
            });
        }
        if (action.type === "delete-folder" && action.id) {
            const tree = layerTree.snapshot(getRenderableLayerIds());
            const foldersToDelete = new Set([action.id]);
            let foundNestedFolder = true;
            while (foundNestedFolder) {
                foundNestedFolder = false;
                tree.folders.forEach((folder) => {
                    if (foldersToDelete.has(folder.parentId) && !foldersToDelete.has(folder.id)) { foldersToDelete.add(folder.id); foundNestedFolder = true; }
                });
            }
            const layerIds = Object.entries(tree.layerParents).filter(([, parentId]) => foldersToDelete.has(parentId)).map(([id]) => id);
            askConfirmation({ title: "Eliminar carpeta", message: `Se eliminará '${action.name}' y ${layerIds.length} capas asociadas.`, confirmText: "Eliminar", cancelText: "Cancelar" }).then((ok) => {
                if (!ok) return;
                layerIds.forEach((id) => onToggleObjectLayer(id, false));
                layerTree.removeFolder(action.id);
                renderList(); renderInfo(); renderCatalogList();
            });
        }
        if (action.type === "move" && action.id && layerTree.move(action.id, action.folderId || null)) renderList();
        if (action.type === "context" && action.id) openContextMenu(action.id, action.x, action.y);
        if (action.type === "add") document.getElementById("openCatalogBtn")?.click();
    });

    function setGlobalVisibility(allVisible) {
        globalLayersVisible = Boolean(allVisible);
        toggleAllVisibilityBtn.textContent = globalLayersVisible ? "👁" : "🙈";
        toggleAllVisibilityBtn.title = globalLayersVisible ? "Ocultar todas las capas" : "Mostrar todas las capas";
        toggleAllVisibilityBtn.setAttribute("aria-label", toggleAllVisibilityBtn.title);
    }

    function syncGlobalVisibilityFromLayers(layerIds) {
        const ids = Array.isArray(layerIds) ? layerIds : getLayerIds();
        if (!ids.length) {
            setGlobalVisibility(true);
            return;
        }

        const allVisible = ids.every((id) => getObjectVisibility(id));
        setGlobalVisibility(allVisible);
    }

    function renderCatalogList() {
        if (!catalogModal.classList.contains("open")) {
            return;
        }

        if (!catalogRefreshBusy) {
            setCatalogRefreshState({ visible: false, text: "", value: 0 });
        }

        catalogCurrentPage = 1;
        requestCatalogPage(catalogCurrentPage);
    }

    function requestCatalogPage(page) {
        const safePage = Math.max(1, Number(page) || 1);
        const token = ++catalogQueryToken;
        catalogRenderToken = token;

        catalogLoadingPage = true;
        catalogProgress.textContent = "Cargando resultados...";
        updateCatalogPaginationState();

        loadCatalogPage(token, safePage);
    }

    async function loadCatalogPage(token, page) {
        if (!fetchCatalogPage) {
            catalogLoadingPage = false;
            return;
        }

        const offset = (page - 1) * CATALOG_PAGE_SIZE;

        try {
            const result = await fetchCatalogPage({
                offset,
                limit: CATALOG_PAGE_SIZE,
                search: catalogFilterState.name,
                orbitKind: catalogFilterState.orbitKind,
                mission: catalogFilterState.mission,
                sourceFormat: catalogFilterState.sourceFormat,
                decayOnly: catalogFilterState.decayOnly
            });

            if (token !== catalogQueryToken) {
                return;
            }

            const ids = Array.isArray(result?.ids) ? result.ids : [];
            const total = Math.max(0, Number(result?.total) || 0);

            catalogServerTotal = total;
            catalogTotalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
            catalogCurrentPage = Math.min(Math.max(1, page), catalogTotalPages);
            catalogOffset = offset + ids.length;
            catalogHasMore = catalogCurrentPage < catalogTotalPages;

            renderCatalogRows(ids, token);
        } catch (error) {
            if (token === catalogQueryToken) {
                showErrorPopup(`No se pudo cargar el catalogo paginado: ${error instanceof Error ? error.message : String(error)}`);
                catalogProgress.textContent = "Error cargando resultados";
                updateCatalogPaginationState();
            }
        } finally {
            if (token === catalogQueryToken) {
                catalogLoadingPage = false;
                updateCatalogPaginationState();
            }
        }
    }

    function updateCatalogPaginationState() {
        const totalPages = Math.max(1, catalogTotalPages);
        const current = Math.min(Math.max(1, catalogCurrentPage), totalPages);

        catalogPageInfo.textContent = `Pagina ${current}/${totalPages}`;
        catalogPrevPageBtn.disabled = catalogBusy || catalogLoadingPage || current <= 1;
        catalogNextPageBtn.disabled = catalogBusy || catalogLoadingPage || current >= totalPages;
    }

    function updateCatalogLoadedProgress() {
        const loaded = lastRenderedCatalogIds.length;
        if (!loaded) {
            catalogProgress.textContent = catalogLoadingPage ? "Cargando resultados..." : "Sin resultados";
            return;
        }

        const start = ((catalogCurrentPage - 1) * CATALOG_PAGE_SIZE) + 1;
        const end = start + loaded - 1;
        const total = Math.max(catalogServerTotal, end);
        catalogProgress.textContent = `Mostrando ${start}-${end} de ${total}`;
    }

    function createCatalogRowElement(id, filtered) {
        const rowEl = document.createElement("div");
        rowEl.className = "catalog-list-row";

        const nameEl = document.createElement("div");
        nameEl.className = "catalog-list-name";
        nameEl.textContent = "";
        nameEl.style.userSelect = "none";

        const active = getObjectLayerActive(id);
        const selected = !active && selectedCatalogIds.has(id);
        const meta = getCatalogMeta(id);
        const entryMeta = getCatalogEntryMeta?.(id) || null;
        const orbitInfo = meta.orbitInfo;
        if (active) rowEl.classList.add("is-added");
        else if (selected) rowEl.classList.add("is-selected");

        const stateEl = document.createElement("div");
        stateEl.className = `catalog-row-state${active ? " is-added" : ""}`;
        stateEl.textContent = active ? "Anadido" : "Disponible";

        if (orbitInfo && orbitInfo.kind !== ORBIT_KIND.UNKNOWN) {
            const orbitTag = createOrbitTypeTagElement(orbitInfo);
            orbitTag.title = orbitInfo.label;
            nameEl.appendChild(orbitTag);
            nameEl.appendChild(document.createTextNode(" "));
        }

        nameEl.appendChild(document.createTextNode(id));

        if (entryMeta?.sourceFormat) {
            const formatBadge = document.createElement("span");
            formatBadge.className = "catalog-format-badge";
            formatBadge.textContent = String(entryMeta.sourceFormat || "TLE").toUpperCase();
            formatBadge.title = `Formato: ${formatBadge.textContent}`;
            nameEl.appendChild(document.createTextNode(" "));
            nameEl.appendChild(formatBadge);
        }

        if (meta.tleAgeWarning) {
            const warningEl = document.createElement("span");
            warningEl.className = "catalog-old-warning";
            warningEl.textContent = " ⚠";
            warningEl.title = buildTleFreshnessMessage(meta.orbitInfo, meta.tleAgeDays);
            nameEl.appendChild(warningEl);
        }

        const explainBtn = document.createElement("button");
        explainBtn.type = "button";
        explainBtn.className = "catalog-row-action-btn";
        explainBtn.textContent = "Info";
        explainBtn.title = `Ver info orbital de ${id}`;
        explainBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            openTleInfo(id, "explain");
        });

        const indexInFiltered = catalogIndexById.get(id);

        rowEl.addEventListener("click", (event) => {
            if (catalogBusy) return;

            const isRangeSelection = event.shiftKey && catalogAnchorIndex !== null;
            const isMultiToggle = event.ctrlKey || event.metaKey;

            if (isRangeSelection && indexInFiltered !== undefined) {
                const from = Math.min(catalogAnchorIndex, indexInFiltered);
                const to = Math.max(catalogAnchorIndex, indexInFiltered);
                if (!isMultiToggle) selectedCatalogIds.clear();

                for (let idx = from; idx <= to; idx++) {
                    const rangeId = filtered[idx];
                    if (!getObjectLayerActive(rangeId)) selectedCatalogIds.add(rangeId);
                }

                catalogAnchorIndex = indexInFiltered;
                refreshRenderedCatalogSelectionStyles();
                updateCatalogActionsState();
                return;
            }

            if (!isMultiToggle) {
                if (selectedCatalogIds.has(id)) {
                    selectedCatalogIds.delete(id);
                    if (catalogAnchorIndex === indexInFiltered) {
                        catalogAnchorIndex = null;
                    }
                } else {
                    selectedCatalogIds.add(id);
                    catalogAnchorIndex = indexInFiltered;
                }

                refreshRenderedCatalogSelectionStyles();
                updateCatalogActionsState();
                return;
            }

            if (selectedCatalogIds.has(id)) {
                selectedCatalogIds.delete(id);
                rowEl.classList.remove("is-selected");
            } else {
                selectedCatalogIds.add(id);
                rowEl.classList.add("is-selected");
            }

            catalogAnchorIndex = indexInFiltered;
            updateCatalogActionsState();
        });

        rowEl.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            if (!getObjectLayerActive(id)) {
                closeContextMenu();
                return;
            }
            openContextMenu(id, event.clientX, event.clientY);
        });

        rowEl.appendChild(nameEl);
        rowEl.appendChild(explainBtn);
        rowEl.appendChild(stateEl);
        catalogRowElements.set(id, rowEl);
        return rowEl;
    }

    function renderCatalogRows(filtered, renderToken) {
        if (!catalogModal.classList.contains("open")) return;
        if (renderToken !== catalogRenderToken) return;

        closeContextMenu();

        lastRenderedCatalogIds = filtered.slice();
        catalogIndexById.clear();
        for (let i = 0; i < lastRenderedCatalogIds.length; i += 1) {
            catalogIndexById.set(lastRenderedCatalogIds[i], i);
        }

        catalogListRoot.innerHTML = "";
        catalogRowElements.clear();

        for (const id of lastRenderedCatalogIds) {
            const rowEl = createCatalogRowElement(id, lastRenderedCatalogIds);
            catalogListRoot.appendChild(rowEl);
        }

        catalogListRoot.scrollTop = 0;
        updateCatalogLoadedProgress();
        updateCatalogPaginationState();
        window.dispatchEvent(new CustomEvent("orbit:catalog-state", {
            detail: {
                rows: lastRenderedCatalogIds.map((id) => {
                    const meta = getCatalogMeta(id);
                    const entry = getCatalogEntryMeta?.(id) || null;
                    return {
                        id,
                        active: getObjectLayerActive(id),
                        selected: selectedCatalogIds.has(id),
                        orbit: meta?.orbitInfo?.kind && meta.orbitInfo.kind !== ORBIT_KIND.UNKNOWN ? meta.orbitInfo.label : "",
                        orbitKind: meta?.orbitInfo?.kind || ORBIT_KIND.UNKNOWN,
                        format: entry?.sourceFormat ? String(entry.sourceFormat).toUpperCase() : ""
                    };
                }),
                selected: [...selectedCatalogIds],
                page: catalogCurrentPage,
                totalPages: catalogTotalPages,
                total: catalogServerTotal,
                search: catalogFilterState.name,
                filters: { ...catalogFilterState },
                busy: catalogBusy || catalogLoadingPage,
                busyText: catalogProgress.textContent || ""
            }
        }));
    }

    function refreshRenderedCatalogSelectionStyles() {
        for (const [id, rowEl] of catalogRowElements.entries()) {
            if (getObjectLayerActive(id)) {
                rowEl.classList.remove("is-selected");
                continue;
            }

            if (selectedCatalogIds.has(id)) {
                rowEl.classList.add("is-selected");
            } else {
                rowEl.classList.remove("is-selected");
            }
        }
    }

    function updateCatalogActionsState() {
        catalogAddSelectedBtn.disabled = catalogBusy || selectedCatalogIds.size === 0;
    }

    function renderInfo() {
        try {
            const telemetry = selectedId && getObjectLayerActive(selectedId)
                ? getObjectTelemetry(selectedId)
                : null;
            const oemDomainActive = Boolean(getLoadedOemTimeBounds?.());
            const sourceFormat = String(telemetry?.source_format || getCatalogEntryMeta?.(selectedId)?.sourceFormat || "TLE").toUpperCase();
            const tle = selectedId && getObjectLayerActive(selectedId) && sourceFormat !== "OEM"
                ? getObjectTle?.(selectedId)
                : null;
            const summary = parseTleSummary(tle);
            const orbitInfoFromTle = getOrbitInfoFromTleSummary(summary, selectedId || "");
            const useTelemetryFallback = !orbitInfoFromTle || orbitInfoFromTle.kind === ORBIT_KIND.UNKNOWN || sourceFormat === "OEM";
            const orbitInfo = useTelemetryFallback
                ? getOrbitInfoFromTelemetry(telemetry, selectedId || "")
                : orbitInfoFromTle;
            infoRoot.innerHTML = buildInfoText(telemetry, orbitInfo, summary, infoSectionOpenState, oemDomainActive);
            window.dispatchEvent(new CustomEvent("orbit:selected-object", {
                detail: selectedId ? {
                    id: selectedId,
                    telemetry,
                    orbitInfo,
                    sourceFormat,
                    noradId: telemetry?.norad_id || telemetry?.norad || telemetry?.catalog_number || tle?.line1?.slice(2, 7).trim() || null,
                    active: getObjectLayerActive(selectedId),
                    visible: getObjectVisibility(selectedId)
                } : null
            }));
        } catch (error) {
            console.warn("No se pudo renderizar telemetria:", error);
            infoRoot.innerHTML = "<div class=\"object-info-empty\">No se pudo actualizar la telemetria. Reintenta seleccionando el satelite.</div>";
        }
    }

    function selectObject(id) {
        if (!id) {
            return;
        }

        if (searchInput) {
            searchInput.value = "";
        }
        layerFilterText = "";
        selectedId = id;
        onSelectObject?.(id);
        if (!useContainer && !sidebar.classList.contains("open")) {
            openSidebar();
        }
        renderList();
        renderInfo();
    }

    function openPanel() {
        openSidebar();
    }

    renderList();
    setGlobalVisibility(true);
    renderInfo();
    closeSidebar();

    const listInterval = setInterval(renderList, 1000);
    const infoInterval = setInterval(renderInfo, 250);

    return {
        selectObject,
        getProjectTree() {
            return layerTree.snapshot(getRenderableLayerIds());
        },
        setProjectTree(snapshot) {
            layerTree.replace(snapshot);
            renderList();
        },
        clearProjectTree() {
            layerTree.clear();
            renderList();
        },
        openGroundStationEditor(layerId) {
            if (!layerId) {
                return;
            }
            openGroundStationModal(layerId);
        },
        openPanel,
        destroy() {
            clearInterval(listInterval);
            clearInterval(infoInterval);
            if (catalogSearchDebounce) {
                clearTimeout(catalogSearchDebounce);
            }
            if (catalogWaitInterval) {
                clearInterval(catalogWaitInterval);
                catalogWaitInterval = null;
            }
            stopCatalogRefreshProgressTimer();
            infoRoot.removeEventListener("pointerdown", onInfoTogglePointerDown);
            document.removeEventListener("dragenter", onGlobalFileDragEnter, true);
            document.removeEventListener("dragleave", onGlobalFileDragLeave, true);
            document.removeEventListener("dragover", onGlobalFileDragOver, true);
            document.removeEventListener("drop", onGlobalFileDrop, true);
            sidebar.remove();
            catalogModal.remove();
            catalogLoadingModal.remove();
            contextMenu.remove();
            addMenu.remove();
            groundStationModal.remove();
            exportModal.remove();
        }
    };
}
