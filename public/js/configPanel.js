const CONFIG_SCHEMA = {
    orbit: [
        { key: "propagation_hours", label: "Propagation Hours", type: "number", step: "0.1", min: "0.1" },
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
        { key: "model_scale", label: "Model Scale", type: "number", step: "0.1", min: "0.1" },
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
        { key: "antialias_enabled", label: "Antialias Enabled", type: "checkbox" },
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
    "orbit.future_color": "Color de la orbita futura.",
    "orbit.past_show": "Muestra u oculta la estela/orbita pasada.",
    "orbit.past_samples": "Cantidad de puntos historicos de estela.",
    "orbit.past_line_width": "Grosor de la linea de orbita pasada.",
    "orbit.past_color": "Color de la orbita pasada.",
    "orbit.hide_near_satellite": "Oculta el tramo de linea muy cercano al satelite.",

    "satellites.label_size_px": "Tamano de texto de label. 0 oculta labels.",
    "satellites.model_scale": "Escala visual del modelo 3D del satelite.",
    "satellites.max_visible": "Numero maximo de satelites visibles en pantalla.",

    "realtime.state_interval_seconds": "Cada cuantos segundos llega el estado por WebSocket.",
    "realtime.orbit_interval_seconds": "Cada cuantos segundos llega la orbita por WebSocket.",
    "realtime.orbit_cache_ttl_seconds": "Tiempo de vida del cache de orbitas en backend.",

    "logging.enabled": "Activa o desactiva trazas del logger.",
    "logging.level": "Nivel de logs: debug, info, warn, error o silent.",

    "rendering.antialias_enabled": "Suaviza bordes de lineas y geometrias.",
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
    toggleBtn.textContent = "Config";

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
            <button class="config-close-btn" id="configCloseBtn" type="button">Cerrar</button>
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

        const grid = document.createElement("div");
        grid.className = "config-grid";

        for (const field of fields) {
            grid.appendChild(createFieldElement(sectionName, field, currentSystemConfig, onChange));
        }

        section.appendChild(title);
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
