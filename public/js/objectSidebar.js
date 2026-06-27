function formatNumber(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return "-";
    }
    return n.toFixed(decimals);
}

function row(label, value, unit = "") {
    return `
        <div class="object-info-row">
            <span class="object-info-key">${label}</span>
            <span class="object-info-value">${value}${unit}</span>
        </div>
    `;
}

function section(title, rowsHtml) {
    return `
        <section class="object-info-section">
            <h4 class="object-info-section-title">${title}</h4>
            <div class="object-info-grid">${rowsHtml}</div>
        </section>
    `;
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

function buildInfoText(telemetry, orbitInfo = null, tleSummary = null) {
    if (!telemetry) {
        return "<div class=\"object-info-empty\">Selecciona un objeto para ver telemetria en tiempo real.</div>";
    }

    const g = telemetry.geo || {};
    const v = telemetry.velocity;

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
        row("Orbita futura", telemetry.has_future_orbit ? "Si" : "No"),
        row("Edad telemetria", formatNumber(telemetry.telemetry_age_ms, 0), " ms"),
        row("Propagacion", "SGP4"),
        row("Tipo orbita", orbitInfo?.label || "Desconocida")
    ].join("");

    const orbitTag = orbitInfo ? buildOrbitTypeTagHtml(orbitInfo) : "";

    return `
        <div class="object-info-title">${orbitTag}${escapeHtml(telemetry.id)}</div>
        ${section("Geografica", geoRows)}
        ${section("Cinematica", kinematicsRows)}
        ${section("Estado", statusRows)}
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
    onRemoveAllLayers,
    onShowAllObjects,
    onHideAllObjects,
    onFocusObject,
    onSelectObject,
    isCatalogReady,
    getObjectTle,
    getObjectTleAsync,
    onRefreshCatalog
}) {
    let selectedId = null;
    let layerFilterText = "";
    let globalLayersVisible = true;
    const selectedCatalogIds = new Set();
    const catalogFilterState = {
        name: "",
        orbitKind: "",
        mission: ""
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
    let lastRenderedCatalogIds = [];
    let catalogServerTotal = 0;
    let catalogOffset = 0;
    let catalogCurrentPage = 1;
    let catalogTotalPages = 1;
    let catalogHasMore = false;
    let catalogLoadingPage = false;
    const catalogIndexById = new Map();
    const catalogMetaCache = new Map();

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
        const missionInfo = inferMissionInfo(id);
        const meta = { tleSummary, orbitInfo, missionInfo, hasTle };
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

    const sidebar = document.createElement("aside");
    sidebar.id = "objectSidebar";
    sidebar.innerHTML = `
        <div class="object-sidebar-header" id="objectSidebarHeader" role="button" tabindex="0" aria-expanded="false">
            <h3 class="object-sidebar-title">Objetos en simulacion</h3>
            <div class="object-sidebar-header-actions">
                <button class="object-global-remove-btn" id="removeAllLayersHeaderBtn" type="button" title="Quitar todas las capas" aria-label="Quitar todas las capas">✕</button>
                <button class="object-global-eye-btn" id="toggleAllVisibilityBtn" type="button" title="Ocultar todas las capas" aria-label="Ocultar todas las capas">👁</button>
                <button class="object-add-btn" id="openCatalogBtn" type="button" title="Añadir desde catalogo" aria-label="Añadir desde catalogo">+</button>
                <span class="object-sidebar-caret" aria-hidden="true">▾</span>
            </div>
        </div>
        <div class="object-sidebar-body">
            <input id="objectSearch" type="text" placeholder="Buscar capa activa..." />
            <div id="objectList"></div>
            <div id="objectInfo">Selecciona un objeto para ver telemetria en tiempo real.</div>
        </div>
    `;
    document.body.appendChild(sidebar);

    const catalogModal = document.createElement("div");
    catalogModal.id = "catalogModal";
    catalogModal.innerHTML = `
        <div class="catalog-modal-panel" role="dialog" aria-modal="true" aria-label="Catalogo de objetos">
            <div class="catalog-modal-header">
                <h3>Catalogo</h3>
                <div class="catalog-modal-header-actions">
                    <button class="catalog-header-btn" id="catalogFiltersBtn" type="button">Filtros</button>
                    <button class="catalog-header-btn" id="catalogRefreshBtn" type="button">Actualizar catalogo</button>
                    <button class="catalog-header-btn" id="catalogSelectAllBtn" type="button">Seleccionar todo</button>
                    <button class="catalog-close-btn" id="catalogCloseBtn" type="button" aria-label="Cerrar catalogo" title="Cerrar">✕</button>
                </div>
            </div>
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
    document.body.appendChild(catalogModal);

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
    document.body.appendChild(confirmModal);

    const catalogLoadingModal = document.createElement("div");
    catalogLoadingModal.id = "catalogLoadingModal";
    catalogLoadingModal.innerHTML = `
        <div class="catalog-loading-panel" role="status" aria-live="polite" aria-label="Cargando catalogo">
            <h3>Cargando catalogo</h3>
            <p>Esperando datos del servidor...</p>
        </div>
    `;
    document.body.appendChild(catalogLoadingModal);

    const contextMenu = document.createElement("div");
    contextMenu.id = "catalogContextMenu";
    contextMenu.innerHTML = `
        <button class="catalog-context-action" id="contextExplainBtn" type="button">Explicar parametros orbitales (TLE)</button>
        <button class="catalog-context-action" id="contextDetailsBtn" type="button">Detalles del satelite</button>
    `;
    document.body.appendChild(contextMenu);

    const tleInfoModal = document.createElement("div");
    tleInfoModal.id = "tleInfoModal";
    tleInfoModal.innerHTML = `
        <div class="tle-info-panel" role="dialog" aria-modal="true" aria-label="Informacion satelite">
            <div class="tle-info-header">
                <h3>Informacion satelite</h3>
                <button class="catalog-close-btn" id="tleInfoCloseBtn" type="button" aria-label="Cerrar" title="Cerrar">✕</button>
            </div>
            <div class="tle-info-content" id="tleInfoContent"></div>
        </div>
    `;
    document.body.appendChild(tleInfoModal);

    const header = sidebar.querySelector("#objectSidebarHeader");
    const removeAllLayersHeaderBtn = sidebar.querySelector("#removeAllLayersHeaderBtn");
    const toggleAllVisibilityBtn = sidebar.querySelector("#toggleAllVisibilityBtn");
    const openCatalogBtn = sidebar.querySelector("#openCatalogBtn");
    const searchInput = sidebar.querySelector("#objectSearch");
    const listRoot = sidebar.querySelector("#objectList");
    const infoRoot = sidebar.querySelector("#objectInfo");

    const catalogCloseBtn = catalogModal.querySelector("#catalogCloseBtn");
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
    const catalogFilterClearBtn = catalogFilterModal.querySelector("#catalogFilterClearBtn");

    const confirmTitle = confirmModal.querySelector("#sidebarConfirmTitle");
    const confirmMessage = confirmModal.querySelector("#sidebarConfirmMessage");
    const confirmCancelBtn = confirmModal.querySelector("#sidebarConfirmCancelBtn");
    const confirmAcceptBtn = confirmModal.querySelector("#sidebarConfirmAcceptBtn");

    const catalogLoadingText = catalogLoadingModal.querySelector("p");

    const contextExplainBtn = contextMenu.querySelector("#contextExplainBtn");
    const contextDetailsBtn = contextMenu.querySelector("#contextDetailsBtn");

    const tleInfoCloseBtn = tleInfoModal.querySelector("#tleInfoCloseBtn");
    const tleInfoContent = tleInfoModal.querySelector("#tleInfoContent");

    function askConfirmation({ title, message, confirmText = "Aceptar", cancelText = "Cancelar" }) {
        return new Promise((resolve) => {
            const close = (result) => {
                confirmModal.classList.remove("open");
                confirmCancelBtn.removeEventListener("click", onCancel);
                confirmAcceptBtn.removeEventListener("click", onAccept);
                confirmModal.removeEventListener("click", onOverlay);
                resolve(result);
            };

            const onCancel = () => close(false);
            const onAccept = () => close(true);
            const onOverlay = (event) => {
                if (event.target === confirmModal) {
                    close(false);
                }
            };

            confirmTitle.textContent = title;
            confirmMessage.textContent = message;
            confirmAcceptBtn.textContent = confirmText;
            confirmCancelBtn.textContent = cancelText;

            confirmCancelBtn.addEventListener("click", onCancel);
            confirmAcceptBtn.addEventListener("click", onAccept);
            confirmModal.addEventListener("click", onOverlay);

            confirmModal.classList.add("open");
        });
    }

    const openSidebar = () => {
        sidebar.classList.add("open");
        header.setAttribute("aria-expanded", "true");
    };

    const closeSidebar = () => {
        sidebar.classList.remove("open");
        header.setAttribute("aria-expanded", "false");
    };

    const toggleSidebar = () => {
        if (sidebar.classList.contains("open")) {
            closeSidebar();
        } else {
            openSidebar();
        }
    };

    const openCatalogModal = () => {
        catalogModal.classList.add("open");
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

        catalogFilterState.orbitKind = populateCatalogSelect(catalogOrbitFilter, orbitOptions, catalogFilterState.orbitKind, "Todas las orbitas");
        catalogFilterState.mission = populateCatalogSelect(catalogMissionFilter, missionOptions, catalogFilterState.mission, "Todas las misiones");
        catalogSearchInput.value = catalogFilterState.name;
        catalogFilterNameInput.value = catalogFilterState.name;
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

        syncCatalogFilterControls();
        renderCatalogList();
    }

    function closeContextMenu() {
        contextMenu.classList.remove("open");
        contextTargetId = null;
    }

    function showToast(message, type = "info", duration = 4500) {
        try {
            const toast = document.createElement("div");
            toast.className = `sidebar-toast sidebar-toast-${type}`;
            toast.textContent = message;
            Object.assign(toast.style, {
                position: "fixed",
                right: "16px",
                bottom: "16px",
                background: type === "error" ? "#6b1f1f" : "#1f6f4f",
                color: "#fff",
                padding: "10px 14px",
                borderRadius: "8px",
                boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
                zIndex: 99999,
                font: "600 13px sans-serif",
                maxWidth: "480px",
                wordBreak: "break-word"
            });

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.transition = "opacity 220ms ease-out, transform 220ms ease-out";
                toast.style.opacity = "0";
                toast.style.transform = "translateY(10px)";
                setTimeout(() => toast.remove(), 240);
            }, duration);
        } catch (e) {
            // Fallback a alert si algo falla
            try { window.alert(message); } catch (_) {}
        }
    }

    function showErrorPopup(message) {
        showToast(message, "error", 6000);
    }

    function showInfoPopup(message) {
        showToast(message, "info", 3800);
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
            title: "Actualizar Catalogo",
            message: "Se descargaran TLEs de CelesTrak y se sobrescribira el catalogo local. Quieres continuar?",
            confirmText: "Actualizar",
            cancelText: "Cancelar"
        });

        if (!ok) {
            return;
        }

        catalogRefreshBusy = true;
        // ocultar el selector de búsqueda mientras dura la actualización y mostrar la barra
        if (catalogSearchInput) catalogSearchInput.hidden = true;
        setCatalogBusyState(true, "Actualizando catalogo...");

        let progress = 4;
        setCatalogRefreshState({
            visible: true,
            text: "Descargando TLEs desde CelesTrak...",
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
                const errorMessage = payload?.error || `Error HTTP ${response.status}`;
                throw new Error(errorMessage);
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
            const discardedInvalid = Number(payload.discardedInvalidEntries) || 0;
            const warningSuffix = failedCount > 0 ? ` (${failedCount} grupos con fallo)` : "";

            const summaryMsg = `Catalogo actualizado: ${payload.writtenEntries || 0} TLEs${warningSuffix}${discardedInvalid > 0 ? `, ${discardedInvalid} descartados` : ""}`;

            setCatalogRefreshState({
                visible: true,
                text: summaryMsg,
                value: 100
            });

            // mostrar popup con resultado
            showInfoPopup(summaryMsg);

            if (failedCount > 0) {
                const failedNames = payload.failedGroups
                    .map((item) => item.group)
                    .slice(0, 8)
                    .join(", ");
                showErrorPopup(`Actualizacion completada con advertencias. Grupos con fallo: ${failedNames}`);
            }

            if (discardedInvalid > 0) {
                showErrorPopup(`Se descartaron ${discardedInvalid} TLEs con formato invalido durante la actualizacion.`);
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
        const menuHeight = 128;
        const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - menuWidth - 8));
        const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuHeight - 8));
        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
        contextMenu.classList.add("open");
    }

    async function resolveTle(satelliteId) {
        let tle = getObjectTle?.(satelliteId) || null;
        if (!tle && getObjectTleAsync) {
            tle = await getObjectTleAsync(satelliteId);
        }
        return tle;
    }

    function openInfoModalWithHtml(html) {
        tleInfoContent.innerHTML = html;
        tleInfoModal.classList.add("open");
    }

    async function openTleInfo(satelliteId, mode) {
        openInfoModalWithHtml(`<div class="tle-info-empty">Cargando informacion...</div>`);

        const tleForOrbit = await resolveTle(satelliteId);
        const tleSummaryForOrbit = parseTleSummary(tleForOrbit);
        const orbitInfo = getOrbitInfoFromTleSummary(tleSummaryForOrbit, satelliteId);

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

    header.addEventListener("click", toggleSidebar);
    header.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleSidebar();
        }
    });

    openCatalogBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openSidebar();
        waitAndOpenCatalog();
    });

    removeAllLayersHeaderBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const total = getLayerIds().length;
        if (!total) {
            return;
        }

        const ok = await askConfirmation({
            title: "Quitar Todas Las Capas",
            message: `Se quitaran ${total} capas activas. Esta accion no se puede deshacer.`,
            confirmText: "Quitar todo",
            cancelText: "Cancelar"
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

    contextDetailsBtn.addEventListener("click", () => {
        if (!contextTargetId) {
            return;
        }
        const id = contextTargetId;
        closeContextMenu();
        openTleInfo(id, "details");
    });

    tleInfoCloseBtn.addEventListener("click", () => {
        tleInfoModal.classList.remove("open");
    });

    tleInfoModal.addEventListener("click", (event) => {
        if (event.target === tleInfoModal) {
            tleInfoModal.classList.remove("open");
        }
    });

    document.addEventListener("click", (event) => {
        if (!contextMenu.classList.contains("open")) {
            return;
        }
        if (contextMenu.contains(event.target)) {
            return;
        }
        closeContextMenu();
    });

    searchInput.addEventListener("input", () => {
        layerFilterText = (searchInput.value || "").toLowerCase();
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

    catalogFilterClearBtn.addEventListener("click", () => {
        applyCatalogFilters({ name: "", orbitKind: "", mission: "" });
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

        applyCatalogFilters({ [key]: "" });
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

        const ids = [...selectedCatalogIds].filter((id) => !getObjectLayerActive(id));
        if (!ids.length) {
            return;
        }

        const ok = await askConfirmation({
            title: "Confirmar Inclusion",
            message: `Se incluiran ${ids.length} elementos que aun no estan en capas activas.`,
            confirmText: "Incluir",
            cancelText: "Cancelar"
        });

        if (!ok) {
            return;
        }

        setCatalogBusyState(true, `Anadiendo capas... 0/${ids.length}`);

        processInChunks(
            ids,
            (id) => onToggleObjectLayer(id, true),
            (done, total) => setCatalogBusyState(true, `Anadiendo capas... ${done}/${total}`)
        ).then(() => {
            selectedId = ids[0];
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
        });
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

        const toSelect = filteredIds.filter((id) => !getObjectLayerActive(id) && !selectedCatalogIds.has(id));

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
                mission: catalogFilterState.mission
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
        catalogFiltersBtn.disabled = isBusy;
        catalogCloseBtn.disabled = isBusy;
        catalogSearchInput.disabled = isBusy;
        catalogFilterNameInput.disabled = isBusy;
        catalogOrbitFilter.disabled = isBusy;
        catalogMissionFilter.disabled = isBusy;
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
        const activeFilterText = String(searchInput?.value || layerFilterText || "").toLowerCase().trim();
        const filtered = ids.filter((id) => id.toLowerCase().includes(activeFilterText));

        listRoot.innerHTML = "";
        for (const id of filtered) {
            const rowEl = document.createElement("div");
            rowEl.className = `object-list-row${id === selectedId ? " active" : ""}`;

            const item = document.createElement("button");
            item.type = "button";
            item.className = `object-list-item${id === selectedId ? " active" : ""}`;
            item.textContent = id;
            item.addEventListener("click", () => {
                selectedId = id;
                onSelectObject?.(selectedId);
                renderList();
                renderInfo();
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

            listRoot.appendChild(rowEl);
        }

        if (selectedId && !ids.includes(selectedId)) {
            selectedId = null;
            renderInfo();
        }

        syncGlobalVisibilityFromLayers(ids);
    }

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
                mission: catalogFilterState.mission
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

        const indexInFiltered = catalogIndexById.get(id);

        rowEl.addEventListener("click", (event) => {
            if (catalogBusy || active) return;

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
            openContextMenu(id, event.clientX, event.clientY);
        });

        rowEl.appendChild(nameEl);
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
        const telemetry = selectedId && getObjectLayerActive(selectedId)
            ? getObjectTelemetry(selectedId)
            : null;
        const tle = selectedId && getObjectLayerActive(selectedId) ? getObjectTle?.(selectedId) : null;
        const summary = parseTleSummary(tle);
        const orbitInfo = getOrbitInfoFromTleSummary(summary, selectedId || "");
        infoRoot.innerHTML = buildInfoText(telemetry, orbitInfo, summary);
    }

    function selectObject(id) {
        if (!id) {
            return;
        }

        selectedId = id;
        onSelectObject?.(id);
        if (!sidebar.classList.contains("open")) {
            openSidebar();
        }
        renderList();
        renderInfo();
    }

    renderList();
    setGlobalVisibility(true);
    renderInfo();
    closeSidebar();

    const listInterval = setInterval(renderList, 1000);
    const infoInterval = setInterval(renderInfo, 250);

    return {
        selectObject,
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
            sidebar.remove();
            catalogModal.remove();
            confirmModal.remove();
            catalogLoadingModal.remove();
            contextMenu.remove();
            tleInfoModal.remove();
        }
    };
}
