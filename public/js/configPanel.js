const CONFIG_SCHEMA = {
    orbit: [
        { key: "propagation_hours", label: "Propagation Hours", type: "number", step: "0.1", min: "0.1" },
        { key: "width_mode", label: "Orbit Width Mode", type: "select", options: ["visual", "physical"] },
        { key: "future_show", label: "Future Show", type: "checkbox" },
        { key: "future_samples", label: "Future Samples", type: "number", step: "1", min: "2" },
        { key: "future_line_width", label: "Future Line Width", type: "number", step: "0.1", min: "0.1" },
        { key: "future_color", label: "Future Color", type: "color" },
        { key: "past_show", label: "Past Show", type: "checkbox" },
        { key: "past_samples", label: "Past Samples", type: "number", step: "1", min: "2" },
        { key: "past_line_width", label: "Past Line Width", type: "number", step: "0.1", min: "0.1" },
        { key: "past_color", label: "Past Color", type: "color" },
        { key: "hide_near_satellite", label: "Hide Near Satellite", type: "checkbox" }
    ],
    satellites: [
        { key: "label_size_px", label: "Label Size (px)", type: "number", step: "1", min: "0" },
        { key: "model_scale", label: "Model Scale", type: "number", step: "1", min: "0.000001" },
        { key: "use_3d_model", label: "Use 3D Model", type: "checkbox" },
        { key: "size_mode", label: "Size Mode", type: "select", options: ["visual", "physical"] },
        { key: "max_visible", label: "Max Visible", type: "number", step: "1", min: "1" }
    ],
    realtime: [
        { key: "state_interval_seconds", label: "State Interval (s)", type: "number", step: "0.1", min: "0.1" },
        { key: "orbit_interval_seconds", label: "Orbit Interval (s)", type: "number", step: "0.1", min: "0.1" },
        { key: "orbit_cache_ttl_seconds", label: "Orbit Cache TTL (s)", type: "number", step: "1", min: "1" }
    ],
    logging: [
        { key: "enabled", label: "Logging Enabled", type: "checkbox" },
        { key: "level", label: "Log Level", type: "select", options: ["debug", "info", "warn", "error", "silent"] }
    ],
    rendering: [
        { key: "antialias_mode", label: "Antialias Mode", type: "select", options: ["off", "fxaa", "msaa"] },
        { key: "resolution_scale_mode", label: "Resolution Scale Mode", type: "select", options: ["auto", "manual"] },
        { key: "resolution_scale", label: "Resolution Scale", type: "number", step: "0.05", min: "0.5", max: "2" },
        { key: "ui_scale_mode", label: "UI Scale Mode", type: "select", options: ["auto", "manual"] },
        { key: "ui_scale", label: "UI Scale", type: "number", step: "0.05", min: "0.7", max: "1.25" },
        { key: "background_color", label: "Background Color", type: "color" },
        { key: "sky_atmosphere", label: "Sky Atmosphere", type: "checkbox" },
        { key: "globe_lighting", label: "Globe Lighting", type: "checkbox" },
        { key: "stars_enabled", label: "Stars Enabled", type: "checkbox" }
    ]
};

const FIELD_HELP = {
    "orbit.propagation_hours": "Horas de proyeccion de la orbita futura.",
    "orbit.future_show": "Muestra u oculta la orbita futura.",
    "orbit.future_samples": "Numero de puntos usados para dibujar la orbita futura.",
    "orbit.future_line_width": "Grosor de la linea de orbita futura.",
    "orbit.width_mode": "visual: grosor fijo en pantalla. physical: grosor aparente cambia con distancia.",
    "orbit.future_color": "Color de la orbita futura.",
    "orbit.past_show": "Muestra u oculta la estela/orbita pasada.",
    "orbit.past_samples": "Cantidad de puntos historicos de estela.",
    "orbit.past_line_width": "Grosor de la linea de orbita pasada.",
    "orbit.past_color": "Color de la orbita pasada.",
    "orbit.hide_near_satellite": "Oculta el tramo de linea muy cercano al satelite.",

    "satellites.label_size_px": "Tamano de texto de label. 0 oculta labels.",
    "satellites.model_scale": "Escala visual del modelo 3D del satelite.",
    "satellites.use_3d_model": "Si esta activo, el satelite se renderiza como modelo 3D. Si no, se dibuja como punto.",
    "satellites.size_mode": "visual: mantiene visibilidad por pixel. physical: respeta mas el tamano angular real por distancia.",
    "satellites.max_visible": "Numero maximo de satelites visibles en pantalla.",

    "realtime.state_interval_seconds": "Cada cuantos segundos llega el estado por WebSocket.",
    "realtime.orbit_interval_seconds": "Cada cuantos segundos llega la orbita por WebSocket.",
    "realtime.orbit_cache_ttl_seconds": "Tiempo de vida del cache de orbitas en backend.",

    "logging.enabled": "Activa o desactiva trazas del logger.",
    "logging.level": "Nivel de logs: debug, info, warn, error o silent.",

    "rendering.antialias_mode": "Elige el metodo de antialiasing: 'off' desactiva suavizado; 'fxaa' aplica FXAA (post-proceso, barato); 'msaa' usa MSAA (mejor calidad si soportado).",
    "rendering.resolution_scale_mode": "auto adapta el render segun DPI/resolucion; manual usa el valor fijo de Resolution Scale.",
    "rendering.resolution_scale": "Escala del render Cesium: < 1 mejora rendimiento y reduce tamano aparente en pantallas densas; > 1 aumenta nitidez y coste GPU.",
    "rendering.ui_scale_mode": "auto adapta el tamano de paneles segun DPI/resolucion; manual aplica escala fija de interfaz.",
    "rendering.ui_scale": "Escala visual de paneles y controles. 1 = tamano base.",
    "rendering.background_color": "Color de fondo del visor.",
    "rendering.sky_atmosphere": "Muestra atmosfera del cielo.",
    "rendering.globe_lighting": "Activa iluminacion del globo por sol.",
    "rendering.stars_enabled": "Muestra el fondo de estrellas."
};

function cloneConfig(obj) {
    if (typeof structuredClone === "function") {
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
}

function createPanelMarkup() {
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "configToggleBtn";
    toggleBtn.type = "button";
    toggleBtn.textContent = "⚙";

    const modal = document.createElement("div");
    modal.id = "configModal";

    const panel = document.createElement("div");
    panel.id = "configPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Configuracion en tiempo real");

    panel.innerHTML = `
        <div id="configPanelHeader">
            <h3>Configuracion en tiempo real</h3>
            <button class="config-close-btn" id="configCloseBtn" type="button" aria-label="Cerrar panel" title="Cerrar">✕</button>
        </div>
        <div id="configHint">Los cambios se aplican al instante en la vista (no guardan el archivo en disco).</div>
        <div id="configForm"></div>
    `;

    modal.appendChild(panel);
    document.body.appendChild(toggleBtn);
    document.body.appendChild(modal);

    return {
        toggleBtn,
        modal,
        panel,
        panelHeader: panel.querySelector("#configPanelHeader"),
        closeBtn: panel.querySelector("#configCloseBtn"),
        formRoot: panel.querySelector("#configForm")
    };
}

function createFieldElement(sectionName, field, currentSystemConfig, onChange) {
    const wrapper = document.createElement("div");
    wrapper.className = `config-field${field.type === "checkbox" ? " checkbox" : ""}`;

    const inputId = `cfg-${sectionName}-${field.key}`;
    const label = document.createElement("label");
    label.setAttribute("for", inputId);
    label.textContent = field.label;

    const helpIcon = document.createElement("span");
    helpIcon.className = "config-help-icon";
    helpIcon.textContent = "i";
    helpIcon.tabIndex = 0;
    helpIcon.setAttribute("role", "img");
    helpIcon.setAttribute("aria-label", "Ayuda del parametro");
    helpIcon.title = FIELD_HELP[`${sectionName}.${field.key}`] || "Sin descripcion disponible.";

    let input;
    if (field.type === "select") {
        input = document.createElement("select");
        for (const optionValue of field.options || []) {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = optionValue;
            input.appendChild(option);
        }
    } else {
        input = document.createElement("input");
        input.type = field.type;
        if (field.step) input.step = field.step;
        if (field.min) input.min = field.min;
        if (field.max) input.max = field.max;
    }

    input.id = inputId;
    input.dataset.section = sectionName;
    input.dataset.key = field.key;
    input.dataset.type = field.type;

    const syncModelFromInput = () => {
        const section = input.dataset.section;
        const key = input.dataset.key;
        const type = input.dataset.type;

        if (!currentSystemConfig || !currentSystemConfig[section]) {
            return;
        }

        let value;
        if (type === "checkbox") {
            value = input.checked;
        } else if (type === "number") {
            const parsed = Number(input.value);
            value = Number.isFinite(parsed) ? parsed : currentSystemConfig[section][key];
        } else {
            value = input.value;
        }

        currentSystemConfig[section][key] = value;
        onChange(cloneConfig(currentSystemConfig));
    };

    input.addEventListener("change", syncModelFromInput);
    if (field.type === "range" || field.type === "number" || field.type === "color") {
        input.addEventListener("input", syncModelFromInput);
    }

    if (field.type === "checkbox") {
        wrapper.appendChild(input);
        wrapper.appendChild(label);
        wrapper.appendChild(helpIcon);
    } else {
        const labelRow = document.createElement("div");
        labelRow.className = "config-label-row";
        labelRow.appendChild(label);
        labelRow.appendChild(helpIcon);
        wrapper.appendChild(labelRow);
        wrapper.appendChild(input);
    }

    return wrapper;
}

function renderConfigPanel(formRoot, currentSystemConfig, onChange) {
    formRoot.innerHTML = "";

    for (const [sectionName, fields] of Object.entries(CONFIG_SCHEMA)) {
        if (!currentSystemConfig[sectionName]) {
            continue;
        }

        const section = document.createElement("section");
        section.className = "config-section";

        const title = document.createElement("h4");
        title.className = "config-section-title";
        title.textContent = sectionName;

        // Special handling for 'orbit' to separate future and past groups
        if (sectionName === "orbit") {
            const orbitWrapper = document.createElement("div");
            orbitWrapper.className = "orbit-wrapper";

            const futureTitle = document.createElement("div");
            futureTitle.className = "orbit-subtitle";
            futureTitle.textContent = "Futuro";

            const futureGrid = document.createElement("div");
            futureGrid.className = "config-grid orbit-grid";

            const pastTitle = document.createElement("div");
            pastTitle.className = "orbit-subtitle";
            pastTitle.textContent = "Pasado";

            const pastGrid = document.createElement("div");
            pastGrid.className = "config-grid orbit-grid";

            // Collect fields by key to allow custom ordering for past/future
            const futureFields = [];
            const pastFields = [];
            const otherOrbitFields = [];
            const fieldByKey = new Map();
            for (const field of fields) {
                fieldByKey.set(String(field.key), field);
                if (String(field.key).startsWith("future")) {
                    futureFields.push(field);
                } else if (String(field.key).startsWith("past")) {
                    pastFields.push(field);
                } else {
                    otherOrbitFields.push(field);
                }
            }

            // Force explicit future field order so we can swap positions as requested
            const desiredFutureOrder = [
                "future_samples",
                "future_line_width",
                // place width_mode here (swapped with future_show)
                "width_mode",
                "future_color",
                "future_show"
            ];

            const usedFuture = new Set();
            for (const key of desiredFutureOrder) {
                const f = fieldByKey.get(key);
                if (f) {
                    const el = createFieldElement(sectionName, f, currentSystemConfig, onChange);
                    // align future color and show to left per last request
                    if (key === "future_color" || key === "future_show") {
                        el.classList.add("align-left");
                    }
                    futureGrid.appendChild(el);
                    usedFuture.add(key);
                }
            }

            // append any remaining futureFields preserving original order
            for (const f of futureFields) {
                const k = String(f.key || "");
                if (usedFuture.has(k)) continue;
                futureGrid.appendChild(createFieldElement(sectionName, f, currentSystemConfig, onChange));
                usedFuture.add(k);
            }

            // Past: prefer order [past_samples, past_line_width, past_show, past_color]
            const desiredPastOrder = ["past_samples", "past_line_width", "past_color", "past_show"];
            const used = new Set();
            for (const key of desiredPastOrder) {
                const f = fieldByKey.get(key);
                if (f) {
                    pastGrid.appendChild(createFieldElement(sectionName, f, currentSystemConfig, onChange));
                    used.add(key);
                }
            }
            // Append any remaining past fields in their original order
            for (const f of pastFields) {
                if (!used.has(String(f.key))) {
                    pastGrid.appendChild(createFieldElement(sectionName, f, currentSystemConfig, onChange));
                }
            }

            // Any other orbit fields (e.g., hide_near_satellite) append to future area by default
            // Remove width_mode from otherOrbitFields to avoid duplication if we insert it explicitly
            const otherFiltered = otherOrbitFields.filter((f) => String(f.key) !== "width_mode");
            for (const f of otherFiltered) {
                futureGrid.appendChild(createFieldElement(sectionName, f, currentSystemConfig, onChange));
            }

            orbitWrapper.appendChild(futureTitle);
            orbitWrapper.appendChild(futureGrid);
            orbitWrapper.appendChild(pastTitle);
            orbitWrapper.appendChild(pastGrid);

            section.appendChild(title);
            section.appendChild(orbitWrapper);
            formRoot.appendChild(section);
            continue;
        }

        const grid = document.createElement("div");
        grid.className = "config-grid";

        // Agrupar campos tipo "toolbox" arriba dentro de la sección (heurística por clave)
        const toolboxFields = [];
        const otherFields = [];
        for (const field of fields) {
            const key = String(field.key || "").toLowerCase();
            if (key.includes("tool") || key.includes("toolbox") || key.includes("tbx")) {
                toolboxFields.push(field);
            } else {
                otherFields.push(field);
            }
        }

        section.appendChild(title);

        if (toolboxFields.length) {
            const subHeading = document.createElement("div");
            subHeading.className = "config-subheading";
            subHeading.textContent = "Toolboxes";
            section.appendChild(subHeading);

            const toolboxGrid = document.createElement("div");
            toolboxGrid.className = "config-grid";
            for (const field of toolboxFields) {
                toolboxGrid.appendChild(createFieldElement(sectionName, field, currentSystemConfig, onChange));
            }
            section.appendChild(toolboxGrid);
        }

        // añadir el resto de campos
        for (const field of otherFields) {
            grid.appendChild(createFieldElement(sectionName, field, currentSystemConfig, onChange));
        }

        section.appendChild(grid);
        formRoot.appendChild(section);
    }
}

function syncConfigPanelValues(formRoot, currentSystemConfig) {
    const inputs = formRoot.querySelectorAll("[data-section][data-key]");
    for (const input of inputs) {
        const section = input.dataset.section;
        const key = input.dataset.key;
        const type = input.dataset.type;
        const value = currentSystemConfig?.[section]?.[key];

        if (type === "checkbox") {
            input.checked = Boolean(value);
        } else if (type === "color") {
            input.value = typeof value === "string" ? value : "#000000";
        } else if (value !== undefined && value !== null) {
            input.value = String(value);
        }
    }
}

function makePanelDraggable(panelHeader, panel) {
    let dragStartX = 0;
    let dragStartY = 0;
    let panelOffsetX = 0;
    let panelOffsetY = 0;
    let dragging = false;

    const applyPanelTransform = () => {
        panel.style.transform = `translate(${panelOffsetX}px, ${panelOffsetY}px)`;
    };

    const startDrag = (clientX, clientY) => {
        dragging = true;
        dragStartX = clientX;
        dragStartY = clientY;
    };

    const moveDrag = (clientX, clientY) => {
        if (!dragging) return;
        panelOffsetX += clientX - dragStartX;
        panelOffsetY += clientY - dragStartY;
        dragStartX = clientX;
        dragStartY = clientY;
        applyPanelTransform();
    };

    const endDrag = () => {
        dragging = false;
    };

    panelHeader.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        startDrag(event.clientX, event.clientY);
        event.preventDefault();
    });

    panelHeader.addEventListener("touchstart", (event) => {
        const touch = event.touches[0];
        if (!touch) return;
        startDrag(touch.clientX, touch.clientY);
    }, { passive: true });

    window.addEventListener("mousemove", (event) => moveDrag(event.clientX, event.clientY));
    window.addEventListener("touchmove", (event) => {
        const touch = event.touches[0];
        if (!touch) return;
        moveDrag(touch.clientX, touch.clientY);
    }, { passive: true });

    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);
}

export function setupRuntimeConfigPanel({ initialSystemConfig, onSystemConfigChange }) {
    let currentSystemConfig = cloneConfig(initialSystemConfig || {});
    const { toggleBtn, modal, panel, panelHeader, closeBtn, formRoot } = createPanelMarkup();

    const propagateChange = (nextSystemConfig) => {
        currentSystemConfig = cloneConfig(nextSystemConfig);
        onSystemConfigChange(cloneConfig(currentSystemConfig));
    };

    renderConfigPanel(formRoot, currentSystemConfig, propagateChange);
    syncConfigPanelValues(formRoot, currentSystemConfig);
    makePanelDraggable(panelHeader, panel);

    const openModal = () => {
        modal.classList.add("open");
        syncConfigPanelValues(formRoot, currentSystemConfig);
    };

    const closeModal = () => modal.classList.remove("open");

    toggleBtn.addEventListener("click", openModal);
    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });

    return {
        setSystemConfig(nextConfig) {
            currentSystemConfig = cloneConfig(nextConfig || {});
            syncConfigPanelValues(formRoot, currentSystemConfig);
        }
    };
}
