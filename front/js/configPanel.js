const CONFIG_SCHEMA = {
    orbit: [
        { key: "propagation_hours", label: "Propagation Hours", type: "number", step: "0.1", min: "0" },
        { key: "future_show", label: "Future Show", type: "checkbox" },
        { key: "ground_track_show", label: "Ground Track Show", type: "checkbox" },
        { key: "future_line_width", label: "Future Line Width", type: "number", step: "0.25", min: "2", max: "5" },
        { key: "future_color", label: "Future Color", type: "color" },
        { key: "selected_color", label: "Selected Orbit Color", type: "color" }
    ],
    satellites: [
        { key: "label_size_px", label: "Label Size (px)", type: "number", step: "1", min: "0" },
        { key: "model_scale", label: "Model Scale", type: "number", step: "1", min: "0.000001" },
        { key: "use_3d_model", label: "Use 3D Model", type: "checkbox" },
        { key: "size_mode", label: "Size Mode", type: "select", options: ["visual", "physical"] },
        { key: "decay_alert_perigee_km", label: "Decay Alert Perigee (km)", type: "number", step: "1", min: "50", max: "5000" }
    ],
    realtime: [
        { key: "state_interval_seconds", label: "State Interval (s)", type: "number", step: "0.1", min: "0.1" },
        { key: "orbit_interval_seconds", label: "Orbit Interval (s)", type: "number", step: "0.1", min: "0.1" }
    ],
    logging: [
        { key: "enabled", label: "Logging Enabled", type: "checkbox" },
        { key: "level", label: "Log Level", type: "select", options: ["debug", "info", "warn", "error", "silent"] },
        { key: "show_top_clock", label: "Show Top Clock", type: "checkbox" }
    ],
    rendering: [
        { key: "antialias_mode", label: "Antialias Mode", type: "select", options: ["off", "fxaa", "msaa"] },
        { key: "background_color", label: "Background Color", type: "color" },
        { key: "sky_atmosphere", label: "Sky Atmosphere", type: "checkbox" },
        { key: "globe_lighting", label: "Globe Lighting", type: "checkbox" },
        { key: "stars_enabled", label: "Stars Enabled", type: "checkbox" },
        { key: "earth_basemap", label: "Earth Basemap", type: "select", options: ["natural-earth", "earth2km-local", "openstreetmap", "esri-world-imagery"] }
    ],
    recording: [
        { key: "quality", label: "Recording Quality", type: "select", options: ["low", "medium", "high"] },
        { key: "output_format", label: "Output Format", type: "select", options: ["webm", "mp4"] }
    ],
    ui: [
        { key: "language", label: "Idioma / Language", type: "select", options: ["es", "en"] },
        { key: "theme", label: "Tema / Theme", type: "select", options: ["dark", "light"] }
    ]
};

const CONFIG_TABS = [
    { id: "orbital", label: "Orbital", sections: ["orbit", "realtime"] },
    { id: "objetos", label: "Objetos", sections: ["satellites"] },
    { id: "escena", label: "Escena", sections: ["rendering", "recording"] },
    { id: "sistema", label: "Sistema", sections: ["logging", "ui"] }
];

const SECTION_TITLES = {
    orbit: "Orbitas",
    satellites: "Satelites",
    realtime: "Tiempo real",
    logging: "Logs",
    rendering: "Render",
    recording: "Grabacion",
    ui: "Interfaz"
};

const FIELD_HELP = {
    "orbit.propagation_hours": "Horas de proyeccion de la orbita futura. Si se configura un rango temporal grande, puede impactar en el rendimiento.",
    "orbit.future_show": "Muestra u oculta la orbita futura.",
    "orbit.ground_track_show": "En 2D muestra u oculta el circulo de visibilidad geometrica. En 3D y Columbus controla la traza de suelo y su huella.",
    "orbit.future_line_width": "Grosor visual fijo de la linea de orbita futura (2 a 5 px).",
    "orbit.future_color": "Color de la orbita futura.",
    "orbit.selected_color": "Color de la orbita del satelite seleccionado.",

    "satellites.label_size_px": "Tamano de texto de label. 0 oculta labels.",
    "satellites.model_scale": "Escala visual del modelo 3D del satelite.",
    "satellites.use_3d_model": "Si esta activo, el satelite se renderiza como modelo 3D. Si no, se dibuja como punto.",
    "satellites.size_mode": "visual: mantiene visibilidad por pixel. physical: respeta mas el tamano angular real por distancia.",
    "satellites.decay_alert_perigee_km": "Umbral de perigeo (km) para marcar objetos en riesgo de decaimiento en filtros y alertas.",

    "realtime.state_interval_seconds": "Cada cuantos segundos llega el estado por WebSocket.",
    "realtime.orbit_interval_seconds": "Cada cuantos segundos llega la orbita por WebSocket.",

    "logging.enabled": "Activa o desactiva trazas del logger.",
    "logging.level": "Nivel de logs: debug, info, warn, error o silent.",
    "logging.show_top_clock": "Muestra u oculta el reloj superior (fecha y hora actual).",

    "rendering.antialias_mode": "Elige el metodo de antialiasing: 'off' desactiva suavizado; 'fxaa' aplica FXAA (post-proceso, barato); 'msaa' usa MSAA (mejor calidad si soportado).",
    "rendering.background_color": "Color de fondo del visor.",
    "rendering.sky_atmosphere": "Muestra atmosfera del cielo.",
    "rendering.globe_lighting": "Activa iluminacion del globo por sol.",
    "rendering.stars_enabled": "Muestra el fondo de estrellas.",
    "rendering.earth_basemap": "Mapa base de la Tierra. Natural Earth funciona sin red; Earth 2 km requiere teselas locales y los mapas externos requieren conexion.",

    "recording.quality": "Calidad de video de grabacion: low (24 FPS, ligero), medium (30 FPS, equilibrado), high (hasta 60 FPS, mas fluido).",
    "recording.output_format": "Formato de salida preferido. Si no es compatible con el navegador, se usa webm automaticamente.",

    "ui.language": "Idioma principal de la interfaz. es = Espanol, en = English.",
    "ui.theme": "Tema visual de la interfaz: oscuro o claro."
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
    panel.setAttribute("aria-label", uiTextCallback("configPanelTitle"));

    panel.innerHTML = `
        <div id="configPanelHeader">
            <h3>${uiTextCallback("configPanelTitle")}</h3>
            <div class="config-header-actions">
                <button class="config-apply-global-btn" id="configApplyGlobalBtn" type="button" title="${uiTextCallback("configApplyGlobal")}">${uiTextCallback("configApplyGlobal")}</button>
                <button class="config-reset-btn" id="configResetBtn" type="button" title="${uiTextCallback("configResetParams")}">${uiTextCallback("configResetParams")}</button>
                <button class="config-close-btn" id="configCloseBtn" type="button" aria-label="${uiTextCallback("configClose")}" title="${uiTextCallback("configClose")}">✕</button>
            </div>
        </div>
        <div id="configHint">${uiTextCallback("configHint")}</div>
        <div id="configValidationBanner" class="config-validation-banner" hidden aria-live="assertive"></div>
        <div id="configSaveStatus" class="config-save-status idle" aria-live="polite">${uiTextCallback("configSaved")}</div>
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
        applyGlobalBtn: panel.querySelector("#configApplyGlobalBtn"),
        resetBtn: panel.querySelector("#configResetBtn"),
        closeBtn: panel.querySelector("#configCloseBtn"),
        validationBanner: panel.querySelector("#configValidationBanner"),
        saveStatus: panel.querySelector("#configSaveStatus"),
        formRoot: panel.querySelector("#configForm")
    };
}

function showValidationBanner(validationBannerElement, message) {
    if (!validationBannerElement) {
        return;
    }

    validationBannerElement.hidden = false;
    validationBannerElement.textContent = message;
}

function hideValidationBanner(validationBannerElement) {
    if (!validationBannerElement) {
        return;
    }

    validationBannerElement.hidden = true;
    validationBannerElement.textContent = "";
}

function setSaveStatus(saveStatusElement, state, message) {
    if (!saveStatusElement) {
        return;
    }

    const nextState = state || "idle";
    saveStatusElement.classList.remove("idle", "saving", "saved", "error");
    saveStatusElement.classList.add(nextState);

    if (message) {
        saveStatusElement.textContent = message;
        return;
    }

    if (nextState === "saving") {
        saveStatusElement.textContent = uiTextCallback("configSaving");
    } else if (nextState === "saved") {
        saveStatusElement.textContent = uiTextCallback("configSavedState");
    } else if (nextState === "error") {
        saveStatusElement.textContent = uiTextCallback("configError");
    } else {
        saveStatusElement.textContent = uiTextCallback("configSaved");
    }
}

function createFieldElement(sectionName, field, currentSystemConfig, onChange, onValidationError, onValidationOk) {
    const wrapper = document.createElement("div");
    wrapper.className = `config-field${field.type === "checkbox" ? " checkbox" : ""}`;

    const inputId = `cfg-${sectionName}-${field.key}`;
    const label = document.createElement("label");
    label.setAttribute("for", inputId);
    label.textContent = field.label;
    label.title = FIELD_HELP[`${sectionName}.${field.key}`] || uiTextCallback("noDesc");

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
            const rawValue = String(input.value ?? "").trim();
            const normalizedRawValue = rawValue.replace(",", ".");

            if (!normalizedRawValue) {
                onValidationError?.(`${field.label}: valor numerico no valido.`);
                return;
            }

            const parsed = Number(normalizedRawValue);
            if (!Number.isFinite(parsed)) {
                onValidationError?.(`${field.label}: valor numerico no valido.`);
                return;
            }

            const min = field.min !== undefined ? Number(field.min) : Number.NEGATIVE_INFINITY;
            const max = field.max !== undefined ? Number(field.max) : Number.POSITIVE_INFINITY;

            if (Number.isFinite(min) && parsed < min) {
                onValidationError?.(`${field.label}: valor fuera de rango. Minimo permitido: ${min}.`);
                return;
            }

            if (Number.isFinite(max) && parsed > max) {
                onValidationError?.(`${field.label}: valor fuera de rango. Maximo permitido: ${max}.`);
                return;
            }

            value = parsed;
            input.value = String(parsed);
        } else {
            value = input.value;
        }

        onValidationOk?.();
        currentSystemConfig[section][key] = value;
        onChange(cloneConfig(currentSystemConfig));
    };

    const syncDraftInput = () => {
        if (input.dataset.type !== "number") {
            syncModelFromInput();
            return;
        }

        // Permitir estados intermedios de escritura (vacío, separador decimal, etc.)
        // y validar/propagar solo en el evento "change".
        onValidationOk?.();
    };

    input.addEventListener("change", syncModelFromInput);
    if (field.type === "range" || field.type === "color") {
        input.addEventListener("input", syncModelFromInput);
    }
    if (field.type === "number") {
        input.addEventListener("input", syncDraftInput);
    }

    if (field.type === "checkbox") {
        wrapper.appendChild(input);
        wrapper.appendChild(label);
    } else {
        wrapper.appendChild(label);
        wrapper.appendChild(input);
    }

    return wrapper;
}

function renderConfigSection(sectionName, fields, currentSystemConfig, onChange, onValidationError, onValidationOk) {
    if (!currentSystemConfig[sectionName]) {
        return null;
    }

    const section = document.createElement("section");
    section.className = "config-section";

    const title = document.createElement("h4");
    title.className = "config-section-title";
    title.textContent = SECTION_TITLES[sectionName] || sectionName;

    const grid = document.createElement("div");
    grid.className = "config-grid";

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
            toolboxGrid.appendChild(createFieldElement(sectionName, field, currentSystemConfig, onChange, onValidationError, onValidationOk));
        }
        section.appendChild(toolboxGrid);
    }

    for (const field of otherFields) {
        grid.appendChild(createFieldElement(sectionName, field, currentSystemConfig, onChange, onValidationError, onValidationOk));
    }

    section.appendChild(grid);
    return section;
}

function renderConfigPanel(formRoot, currentSystemConfig, onChange, onValidationError, onValidationOk) {
    formRoot.innerHTML = "";

    const availableTabs = CONFIG_TABS.filter((tab) => tab.sections.some((sectionName) => currentSystemConfig[sectionName]));
    if (!availableTabs.length) {
        return;
    }

    const tabsBar = document.createElement("div");
    tabsBar.className = "config-tabs";
    tabsBar.setAttribute("role", "tablist");
    tabsBar.setAttribute("aria-label", "Categorias de configuracion");

    const tabPanelsRoot = document.createElement("div");
    tabPanelsRoot.className = "config-tab-panels";

    const tabButtons = [];
    const tabPanels = [];

    const activateTab = (tabId) => {
        for (const button of tabButtons) {
            const isActive = button.dataset.tabId === tabId;
            button.classList.toggle("active", isActive);
            button.setAttribute("aria-selected", isActive ? "true" : "false");
            button.tabIndex = isActive ? 0 : -1;
        }

        for (const panel of tabPanels) {
            const isActive = panel.dataset.tabId === tabId;
            panel.hidden = !isActive;
            panel.classList.toggle("active", isActive);
        }
    };

    for (const [index, tab] of availableTabs.entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "config-tab-btn";
        button.dataset.tabId = tab.id;
        button.id = `cfg-tab-${tab.id}`;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-controls", `cfg-panel-${tab.id}`);
        button.setAttribute("aria-selected", index === 0 ? "true" : "false");
        button.tabIndex = index === 0 ? 0 : -1;
        button.textContent = tab.label;
        button.addEventListener("click", () => activateTab(tab.id));

        const panel = document.createElement("div");
        panel.className = "config-tab-panel";
        panel.dataset.tabId = tab.id;
        panel.id = `cfg-panel-${tab.id}`;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", button.id);
        panel.hidden = index !== 0;

        for (const sectionName of tab.sections) {
            const fields = CONFIG_SCHEMA[sectionName];
            if (!fields || !currentSystemConfig[sectionName]) {
                continue;
            }
            const section = renderConfigSection(sectionName, fields, currentSystemConfig, onChange, onValidationError, onValidationOk);
            if (section) {
                panel.appendChild(section);
            }
        }

        tabsBar.appendChild(button);
        tabPanelsRoot.appendChild(panel);
        tabButtons.push(button);
        tabPanels.push(panel);
    }

    formRoot.appendChild(tabsBar);
    formRoot.appendChild(tabPanelsRoot);
    activateTab(availableTabs[0].id);
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

let uiTextCallback = null;

export function setupRuntimeConfigPanel({
    initialSystemConfig,
    defaultSystemConfig,
    onSystemConfigChange,
    onResetSpecificConfig,
    onApplyGlobalToAll,
    getUiText
}) {
    // getUiText es una función que devuelve el traductor actual: () => (key) => string
    // Resolvemos el traductor en cada llamada para reaccionar a cambios de idioma.
    const uiTextProvider = typeof getUiText === "function" ? getUiText : () => (key) => key;
    uiTextCallback = (key) => {
        const translator = uiTextProvider();
        return typeof translator === "function" ? translator(key) : key;
    };
    let currentSystemConfig = cloneConfig(initialSystemConfig || {});
    const defaultConfigSnapshot = cloneConfig(defaultSystemConfig || initialSystemConfig || {});

    // React owns the configuration UI. This module remains the runtime adapter
    // that validates/applies values and persists them through its callbacks.
    const emitState = () => window.dispatchEvent(new CustomEvent("orbit:config-panel-state", {
        detail: { config: cloneConfig(currentSystemConfig) }
    }));
    const emitStatus = (state, message) => window.dispatchEvent(new CustomEvent("orbit:config-panel-status", {
        detail: { state, message }
    }));
    const applyChange = (section, key, value) => {
        if (!currentSystemConfig[section] || !Object.hasOwn(currentSystemConfig[section], key)) return;
        const currentValue = currentSystemConfig[section][key];
        let nextValue = value;
        if (typeof currentValue === "number") {
            nextValue = Number(value);
            if (!Number.isFinite(nextValue)) return;
        }
        if (typeof currentValue === "boolean") nextValue = value === true;
        currentSystemConfig = cloneConfig({ ...currentSystemConfig, [section]: { ...currentSystemConfig[section], [key]: nextValue } });
        onSystemConfigChange(cloneConfig(currentSystemConfig));
        emitState();
        emitStatus("saved", uiTextCallback("configSavedState"));
    };
    window.addEventListener("orbit:config-panel-action", async (event) => {
        const action = event.detail || {};
        if (action.type === "change") {
            applyChange(action.section, action.key, action.value);
            return;
        }
        try {
            if (action.type === "apply-global") {
                emitStatus("saving", uiTextCallback("applyingGlobal"));
                await onApplyGlobalToAll?.();
                emitStatus("saved", uiTextCallback("globalApplied"));
            }
            if (action.type === "reset") {
                emitStatus("saving", uiTextCallback("resettingParams"));
                currentSystemConfig = cloneConfig(defaultConfigSnapshot);
                onSystemConfigChange(cloneConfig(currentSystemConfig));
                await onResetSpecificConfig?.();
                emitState();
                emitStatus("saved", uiTextCallback("paramsReset"));
            }
        } catch (error) {
            emitStatus("error", error instanceof Error ? error.message : String(error));
        }
    });
    emitState();
    emitStatus("idle", uiTextCallback("configSaved"));
    return {
        setSystemConfig(nextConfig) {
            currentSystemConfig = cloneConfig(nextConfig || {});
            emitState();
        },
        setSaveState(state, message) { emitStatus(state, message); },
        open() { window.dispatchEvent(new Event("orbit:config-panel-open")); },
        close() { window.dispatchEvent(new Event("orbit:config-panel-close")); },
        toggle() { window.dispatchEvent(new Event("orbit:config-panel-toggle")); }
    };

    const { toggleBtn, modal, panel, panelHeader, applyGlobalBtn, resetBtn, closeBtn, validationBanner, saveStatus, formRoot } = createPanelMarkup();

    const propagateChange = (nextSystemConfig) => {
        currentSystemConfig = cloneConfig(nextSystemConfig);
        onSystemConfigChange(cloneConfig(currentSystemConfig));
    };

    renderConfigPanel(
        formRoot,
        currentSystemConfig,
        propagateChange,
        (message) => showValidationBanner(validationBanner, message),
        () => hideValidationBanner(validationBanner)
    );
    syncConfigPanelValues(formRoot, currentSystemConfig);
    makePanelDraggable(panelHeader, panel);

    const openModal = () => {
        modal.classList.add("open");
        syncConfigPanelValues(formRoot, currentSystemConfig);
    };

    const closeModal = () => modal.classList.remove("open");

    toggleBtn.addEventListener("click", openModal);
    applyGlobalBtn.addEventListener("click", async () => {
        try {
            setSaveStatus(saveStatus, "saving", uiTextCallback("applyingGlobal"));
            hideValidationBanner(validationBanner);

            if (typeof onApplyGlobalToAll === "function") {
                await onApplyGlobalToAll();
            }

            setSaveStatus(saveStatus, "saved", uiTextCallback("globalApplied"));
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            setSaveStatus(saveStatus, "error", uiTextCallback("globalError") + ": " + detail);
        }
    });
    resetBtn.addEventListener("click", async () => {
        try {
            setSaveStatus(saveStatus, "saving", uiTextCallback("resettingParams"));
            hideValidationBanner(validationBanner);

            currentSystemConfig = cloneConfig(defaultConfigSnapshot);
            syncConfigPanelValues(formRoot, currentSystemConfig);
            onSystemConfigChange(cloneConfig(currentSystemConfig));

            if (typeof onResetSpecificConfig === "function") {
                await onResetSpecificConfig();
            }

            setSaveStatus(saveStatus, "saved", uiTextCallback("paramsReset"));
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            setSaveStatus(saveStatus, "error", uiTextCallback("resetError") + ": " + detail);
        }
    });
    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });

    setSaveStatus(saveStatus, "idle");

    return {
        setSystemConfig(nextConfig) {
            currentSystemConfig = cloneConfig(nextConfig || {});
            syncConfigPanelValues(formRoot, currentSystemConfig);
        },
        setSaveState(state, message) {
            setSaveStatus(saveStatus, state, message);
        },
        open() {
            openModal();
        },
        close() {
            closeModal();
        },
        toggle() {
            if (modal.classList.contains("open")) {
                closeModal();
            } else {
                openModal();
            }
        }
    };
}
