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

function buildInfoText(telemetry) {
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
        row("Edad telemetria", formatNumber(telemetry.telemetry_age_ms, 0), " ms")
    ].join("");

    return `
        <div class="object-info-title">${telemetry.id}</div>
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

function buildTleExplanationHtml(satelliteId, tleSummary) {
    if (!tleSummary) {
        return `<div class="tle-info-empty">No hay TLE disponible para <strong>${escapeHtml(satelliteId)}</strong>.</div>`;
    }

    return `
        <div class="tle-info-title">${escapeHtml(satelliteId)}</div>
        <section class="tle-info-section">
            <h4>Lineas TLE</h4>
            <pre>${escapeHtml(tleSummary.line1)}\n${escapeHtml(tleSummary.line2)}</pre>
        </section>
        <section class="tle-info-section">
            <h4>Parametros Orbitales</h4>
            <div class="tle-info-grid">
                <div><span>Epoca</span><strong>${escapeHtml(tleSummary.epoch || "-")}</strong></div>
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

function buildSatelliteDetailsHtml(satelliteId, details) {
    if (!details) {
        return `
            <div class="tle-info-title">${escapeHtml(satelliteId)}</div>
            <div class="tle-info-empty">No se encontro informacion externa fiable para este satelite.</div>
        `;
    }

    return `
        <div class="tle-info-title">${escapeHtml(details.title || satelliteId)}</div>
        <section class="tle-info-section">
            <h4>Resumen</h4>
            <p class="tle-info-paragraph">${escapeHtml(details.summary || "-")}</p>
        </section>
        <section class="tle-info-section">
            <h4>Fuente</h4>
            <p class="tle-info-paragraph">${escapeHtml(details.source || "Wikipedia")}</p>
            ${details.url ? `<a class="tle-info-link" href="${escapeHtml(details.url)}" target="_blank" rel="noopener noreferrer">Abrir referencia</a>` : ""}
        </section>
    `;
}

async function fetchWikipediaDetails(satelliteId) {
    const normalized = (satelliteId || "").trim();
    if (!normalized) {
        return null;
    }

    const base = normalized.replace(/\s*\([^)]*\)\s*/g, "").trim();
    const candidates = [normalized, base].filter(Boolean);

    if (/\bISS\b|ZARYA/i.test(normalized)) {
        candidates.push("International Space Station");
    }
    if (/STARLINK/i.test(normalized)) {
        candidates.push("Starlink", "Starlink satellite constellation");
    }
    if (/SENTINEL/i.test(normalized)) {
        candidates.push("Copernicus Programme", "Sentinel-1", "Sentinel-2");
    }

    const uniqueCandidates = [...new Set(candidates)];

    for (const candidate of uniqueCandidates) {
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
    getObjectTleAsync
}) {
    let selectedId = null;
    let layerFilterText = "";
    let catalogFilterText = "";
    let globalLayersVisible = true;
    const selectedCatalogIds = new Set();

    const CATALOG_RENDER_CHUNK = 250;
    const CATALOG_FILTER_CHUNK = 1200;
    const BULK_PROCESS_CHUNK = 120;

    let catalogRenderToken = 0;
    let catalogFilterToken = 0;
    let catalogSearchDebounce = null;
    let catalogBusy = false;
    let catalogAnchorIndex = null;
    let catalogWaitInterval = null;
    let contextTargetId = null;

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
                    <button class="catalog-header-btn" id="catalogSelectAllBtn" type="button">Seleccionar todo</button>
                    <button class="catalog-close-btn" id="catalogCloseBtn" type="button">Cerrar</button>
                </div>
            </div>
            <input id="catalogSearch" type="text" placeholder="Buscar en catalogo..." />
            <div id="catalogList"></div>
            <div class="catalog-modal-actions">
                <div class="catalog-progress" id="catalogProgress" aria-live="polite"></div>
                <button class="catalog-action-btn" id="catalogAddSelectedBtn" type="button">Añadir seleccionadas</button>
            </div>
        </div>
    `;
    document.body.appendChild(catalogModal);

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
        <button class="catalog-context-action" id="contextRawBtn" type="button">Ver TLE crudo</button>
        <button class="catalog-context-action" id="contextDetailsBtn" type="button">Detalles del satelite</button>
    `;
    document.body.appendChild(contextMenu);

    const tleInfoModal = document.createElement("div");
    tleInfoModal.id = "tleInfoModal";
    tleInfoModal.innerHTML = `
        <div class="tle-info-panel" role="dialog" aria-modal="true" aria-label="Informacion satelite">
            <div class="tle-info-header">
                <h3>Informacion satelite</h3>
                <button class="catalog-close-btn" id="tleInfoCloseBtn" type="button">Cerrar</button>
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
    const catalogSelectAllBtn = catalogModal.querySelector("#catalogSelectAllBtn");
    const catalogSearchInput = catalogModal.querySelector("#catalogSearch");
    const catalogListRoot = catalogModal.querySelector("#catalogList");
    const catalogProgress = catalogModal.querySelector("#catalogProgress");
    const catalogAddSelectedBtn = catalogModal.querySelector("#catalogAddSelectedBtn");

    const confirmTitle = confirmModal.querySelector("#sidebarConfirmTitle");
    const confirmMessage = confirmModal.querySelector("#sidebarConfirmMessage");
    const confirmCancelBtn = confirmModal.querySelector("#sidebarConfirmCancelBtn");
    const confirmAcceptBtn = confirmModal.querySelector("#sidebarConfirmAcceptBtn");

    const catalogLoadingText = catalogLoadingModal.querySelector("p");

    const contextExplainBtn = contextMenu.querySelector("#contextExplainBtn");
    const contextRawBtn = contextMenu.querySelector("#contextRawBtn");
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
        catalogProgress.textContent = "Cargando catalogo...";
        renderCatalogList();
        catalogSearchInput.focus();
    };

    const closeCatalogModal = () => {
        catalogRenderToken += 1;
        catalogModal.classList.remove("open");
        closeContextMenu();
    };

    function closeContextMenu() {
        contextMenu.classList.remove("open");
        contextTargetId = null;
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

        if (mode === "details") {
            const details = await fetchWikipediaDetails(satelliteId);
            openInfoModalWithHtml(buildSatelliteDetailsHtml(satelliteId, details));
            return;
        }

        const tle = await resolveTle(satelliteId);
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
        if (isCatalogReady?.()) {
            openCatalogModal();
            return;
        }

        catalogLoadingText.textContent = "Esperando datos del servidor...";
        catalogLoadingModal.classList.add("open");

        if (catalogWaitInterval) {
            clearInterval(catalogWaitInterval);
            catalogWaitInterval = null;
        }

        let elapsedMs = 0;
        catalogWaitInterval = setInterval(() => {
            elapsedMs += 150;
            if (isCatalogReady?.()) {
                clearInterval(catalogWaitInterval);
                catalogWaitInterval = null;
                catalogLoadingModal.classList.remove("open");
                openCatalogModal();
                return;
            }
            if (elapsedMs >= 2500) {
                catalogLoadingText.textContent = "Sigue cargando... puede tardar unos segundos.";
            }
        }, 150);
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
    catalogModal.addEventListener("click", (event) => {
        if (event.target === catalogModal) {
            closeCatalogModal();
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

    contextRawBtn.addEventListener("click", () => {
        if (!contextTargetId) {
            return;
        }
        const id = contextTargetId;
        closeContextMenu();
        openTleInfo(id, "raw");
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
            catalogFilterText = (catalogSearchInput.value || "").toLowerCase();
            renderCatalogList();
        }, 120);
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
            setCatalogBusyState(false);
            renderList();
            renderInfo();
            renderCatalogList();
            closeCatalogModal();
        });
    });

    catalogSelectAllBtn.addEventListener("click", async () => {
        if (catalogBusy) {
            return;
        }

        const ids = getCatalogIds();
        const filtered = ids.filter((id) => id.toLowerCase().includes(catalogFilterText));
        const toSelect = filtered.filter((id) => !getObjectLayerActive(id) && !selectedCatalogIds.has(id));

        if (!toSelect.length) {
            return;
        }

        const ok = await askConfirmation({
            title: "Seleccionar Muchos Objetos",
            message: `Vas a seleccionar ${toSelect.length} objetos del catalogo. Si luego los anades, puede tardar unos segundos.`,
            confirmText: "Seleccionar",
            cancelText: "Cancelar"
        });

        if (!ok) {
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
        catalogCloseBtn.disabled = isBusy;
        catalogSearchInput.disabled = isBusy;
        catalogProgress.textContent = text;
    }

    function renderList() {
        const ids = getLayerIds();
        const filtered = ids.filter((id) => id.toLowerCase().includes(layerFilterText));

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

        const ids = getCatalogIds();
        const activeRenderToken = ++catalogRenderToken;
        const activeFilterToken = ++catalogFilterToken;

        catalogProgress.textContent = `Filtrando... 0/${ids.length}`;

        buildFilteredIdsAsync(ids, catalogFilterText, activeFilterToken, (done, total) => {
            if (activeRenderToken !== catalogRenderToken) {
                return;
            }
            catalogProgress.textContent = `Filtrando... ${done}/${total}`;
        }).then((filtered) => {
            if (!filtered || activeRenderToken !== catalogRenderToken) {
                return;
            }
            renderCatalogRows(filtered, activeRenderToken);
        });
    }

    function buildFilteredIdsAsync(ids, filterText, token, onProgress) {
        return new Promise((resolve) => {
            const filtered = [];
            let index = 0;
            const needle = (filterText || "").toLowerCase();

            const step = () => {
                if (token !== catalogFilterToken) {
                    resolve(null);
                    return;
                }

                const end = Math.min(index + CATALOG_FILTER_CHUNK, ids.length);
                while (index < end) {
                    const id = ids[index];
                    if (!needle || id.toLowerCase().includes(needle)) {
                        filtered.push(id);
                    }
                    index += 1;
                }

                onProgress?.(index, ids.length);

                if (index < ids.length) {
                    requestAnimationFrame(step);
                    return;
                }

                resolve(filtered);
            };

            requestAnimationFrame(step);
        });
    }

    function renderCatalogRows(filtered, renderToken) {
        catalogListRoot.innerHTML = "";
        closeContextMenu();
        catalogRowElements.clear();

        const total = filtered.length;
        catalogProgress.textContent = total ? `Mostrando ${total} resultados...` : "Sin resultados";

        const renderChunk = (startIndex) => {
            if (renderToken !== catalogRenderToken) {
                return;
            }

            const fragment = document.createDocumentFragment();
            const end = Math.min(startIndex + CATALOG_RENDER_CHUNK, filtered.length);

            for (let i = startIndex; i < end; i++) {
                const id = filtered[i];
                const rowEl = document.createElement("div");
                rowEl.className = "catalog-list-row";

                const nameEl = document.createElement("div");
                nameEl.className = "catalog-list-name";
                nameEl.textContent = id;

                const active = getObjectLayerActive(id);
                const selected = !active && selectedCatalogIds.has(id);
                if (active) {
                    rowEl.classList.add("is-added");
                } else if (selected) {
                    rowEl.classList.add("is-selected");
                }

                const stateEl = document.createElement("div");
                stateEl.className = `catalog-row-state${active ? " is-added" : ""}`;
                stateEl.textContent = active ? "Anadido" : "Disponible";

                rowEl.addEventListener("click", (event) => {
                    if (catalogBusy || active) {
                        return;
                    }

                    const isRangeSelection = event.shiftKey && catalogAnchorIndex !== null;
                    const isMultiToggle = event.ctrlKey || event.metaKey;

                    if (isRangeSelection) {
                        const from = Math.min(catalogAnchorIndex, i);
                        const to = Math.max(catalogAnchorIndex, i);
                        if (!isMultiToggle) {
                            selectedCatalogIds.clear();
                        }

                        for (let index = from; index <= to; index++) {
                            const rangeId = filtered[index];
                            if (!getObjectLayerActive(rangeId)) {
                                selectedCatalogIds.add(rangeId);
                            }
                        }

                        catalogAnchorIndex = i;
                        refreshRenderedCatalogSelectionStyles();
                        updateCatalogActionsState();
                        return;
                    }

                    if (!isMultiToggle) {
                        selectedCatalogIds.clear();
                        selectedCatalogIds.add(id);
                        catalogAnchorIndex = i;
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

                    catalogAnchorIndex = i;
                    updateCatalogActionsState();
                });

                rowEl.addEventListener("contextmenu", (event) => {
                    event.preventDefault();
                    openContextMenu(id, event.clientX, event.clientY);
                });

                rowEl.appendChild(nameEl);
                rowEl.appendChild(stateEl);
                catalogRowElements.set(id, rowEl);
                fragment.appendChild(rowEl);
            }

            catalogListRoot.appendChild(fragment);
            catalogProgress.textContent = `Mostrando ${Math.min(end, total)}/${total}`;

            if (end < filtered.length) {
                requestAnimationFrame(() => renderChunk(end));
                return;
            }

            catalogProgress.textContent = `${total} resultados`;
        };

        requestAnimationFrame(() => renderChunk(0));
        updateCatalogActionsState();
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
        infoRoot.innerHTML = buildInfoText(telemetry);
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

    requestAnimationFrame(() => {
        getCatalogIds();
    });

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
            sidebar.remove();
            catalogModal.remove();
            confirmModal.remove();
            catalogLoadingModal.remove();
            contextMenu.remove();
            tleInfoModal.remove();
        }
    };
}
