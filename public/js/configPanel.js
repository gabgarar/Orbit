const CONFIG_SCHEMA = {
    orbit: [
        { key: "propagation_hours", label: "Propagation Hours", type: "number", step: "0.1", min: "0", max: "240" },
        { key: "width_mode", label: "Orbit Width Mode", type: "select", options: ["visual", "physical"] },
        { key: "future_show", label: "Future Show", type: "checkbox" },
        { key: "future_line_width", label: "Future Line Width", type: "number", step: "0.1", min: "0.1" },
        { key: "future_color", label: "Future Color", type: "color" },
        { key: "selected_color", label: "Selected Orbit Color", type: "color" },
        { key: "past_show", label: "Past Show", type: "checkbox" },
        { key: "past_seconds", label: "Past Duration (s)", type: "number", step: "0.1", min: "0", max: "86400" },
        { key: "past_line_width", label: "Past Line Width", type: "number", step: "0.1", min: "0.1" },
        { key: "past_color", label: "Past Color", type: "color" }
    ],
    satellites: [
        { key: "label_size_px", label: "Label Size (px)", type: "number", step: "1", min: "0" },
        { key: "model_scale", label: "Model Scale", type: "number", step: "1", min: "0.000001" },
        { key: "use_3d_model", label: "Use 3D Model", type: "checkbox" },
        { key: "size_mode", label: "Size Mode", type: "select", options: ["visual", "physical"] }
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
        { key: "stars_enabled", label: "Stars Enabled", type: "checkbox" }
    ],
    recording: [
        { key: "quality", label: "Recording Quality", type: "select", options: ["low", "medium", "high"] },
        { key: "output_format", label: "Output Format", type: "select", options: ["webm", "mp4"] }
    ]
};

const CONFIG_TABS = [
    { id: "orbital", label: "Orbital", sections: ["orbit", "realtime"] },
    { id: "objetos", label: "Objetos", sections: ["satellites"] },
    { id: "escena", label: "Escena", sections: ["rendering", "recording"] },
    { id: "sistema", label: "Sistema", sections: ["logging"] }
];

const SECTION_TITLES = {
    orbit: "Orbitas",
    satellites: "Satelites",
    realtime: "Tiempo real",
    logging: "Logs",
    rendering: "Render",
    recording: "Grabacion"
};

const FIELD_HELP = {
    "orbit.propagation_hours": "Horas de proyeccion de la orbita futura. Rango permitido: 0 a 240 horas.",
    "orbit.future_show": "Muestra u oculta la orbita futura.",
    "orbit.future_line_width": "Grosor de la linea de orbita futura.",
    "orbit.width_mode": "visual: grosor fijo en pantalla. physical: grosor aparente cambia con distancia.",
    "orbit.future_color": "Color de la orbita futura.",
    "orbit.selected_color": "Color de la orbita del satelite seleccionado.",
    "orbit.past_show": "Muestra u oculta la estela/orbita pasada.",
    "orbit.past_seconds": "Duracion temporal de la estela pasada en segundos. Rango permitido: 0 a 86400.",
    "orbit.past_line_width": "Grosor de la linea de orbita pasada.",
    "orbit.past_color": "Color de la orbita pasada.",

    "satellites.label_size_px": "Tamano de texto de label. 0 oculta labels.",
    "satellites.model_scale": "Escala visual del modelo 3D del satelite.",
    "satellites.use_3d_model": "Si esta activo, el satelite se renderiza como modelo 3D. Si no, se dibuja como punto.",
    "satellites.size_mode": "visual: mantiene visibilidad por pixel. physical: respeta mas el tamano angular real por distancia.",

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

    "recording.quality": "Calidad de video de grabacion: low (24 FPS, ligero), medium (30 FPS, equilibrado), high (hasta 60 FPS, mas fluido).",
    "recording.output_format": "Formato de salida preferido. Si no es compatible con el navegador, se usa webm automaticamente."
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
            <div class="config-header-actions">
                <button class="config-apply-global-btn" id="configApplyGlobalBtn" type="button" title="Aplicar configuracion global a todos los satelites">Aplicar global a todos</button>
                <button class="config-reset-btn" id="configResetBtn" type="button" title="Restaurar parametros por defecto">Reiniciar parametros</button>
                <button class="config-close-btn" id="configCloseBtn" type="button" aria-label="Cerrar panel" title="Cerrar">✕</button>
            </div>
        </div>
        <div id="configHint">Los cambios se aplican al instante en la vista y se guardan en disco.</div>
        <div id="configValidationBanner" class="config-validation-banner" hidden aria-live="assertive"></div>
        <div id="configSaveStatus" class="config-save-status idle" aria-live="polite">Estado: sincronizado</div>
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
        saveStatusElement.textContent = "Estado: guardando...";
    } else if (nextState === "saved") {
        saveStatusElement.textContent = "Estado: guardado";
    } else if (nextState === "error") {
        saveStatusElement.textContent = "Estado: error al guardar";
    } else {
        saveStatusElement.textContent = "Estado: sincronizado";
    }
}

function createFieldElement(sectionName, field, currentSystemConfig, onChange, onValidationError, onValidationOk) {
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

function renderConfigSection(sectionName, fields, currentSystemConfig, onChange, onValidationError, onValidationOk) {
    if (!currentSystemConfig[sectionName]) {
        return null;
    }

    const section = document.createElement("section");
    section.className = "config-section";

    const title = document.createElement("h4");
    title.className = "config-section-title";
    title.textContent = SECTION_TITLES[sectionName] || sectionName;

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

        const desiredFutureOrder = [
            "future_line_width",
            "width_mode",
            "future_color",
            "selected_color",
            "future_show"
        ];

        const usedFuture = new Set();
        for (const key of desiredFutureOrder) {
            const f = fieldByKey.get(key);
            if (f) {
                const el = createFieldElement(sectionName, f, currentSystemConfig, onChange, onValidationError, onValidationOk);
                if (key === "future_color" || key === "future_show") {
                    el.classList.add("align-left");
                }
                futureGrid.appendChild(el);
                usedFuture.add(key);
            }
        }

        for (const f of futureFields) {
            const k = String(f.key || "");
            if (usedFuture.has(k)) continue;
            futureGrid.appendChild(createFieldElement(sectionName, f, currentSystemConfig, onChange, onValidationError, onValidationOk));
            usedFuture.add(k);
        }

        const desiredPastOrder = ["past_seconds", "past_line_width", "past_color", "past_show"];
        const used = new Set();
        for (const key of desiredPastOrder) {
            const f = fieldByKey.get(key);
            if (f) {
                pastGrid.appendChild(createFieldElement(sectionName, f, currentSystemConfig, onChange, onValidationError, onValidationOk));
                used.add(key);
            }
        }
        for (const f of pastFields) {
            if (!used.has(String(f.key))) {
                pastGrid.appendChild(createFieldElement(sectionName, f, currentSystemConfig, onChange, onValidationError, onValidationOk));
            }
        }

        const otherFiltered = otherOrbitFields.filter((f) => String(f.key) !== "width_mode");
        for (const f of otherFiltered) {
            futureGrid.appendChild(createFieldElement(sectionName, f, currentSystemConfig, onChange, onValidationError, onValidationOk));
        }

        orbitWrapper.appendChild(futureTitle);
        orbitWrapper.appendChild(futureGrid);
        orbitWrapper.appendChild(pastTitle);
        orbitWrapper.appendChild(pastGrid);

        section.appendChild(title);
        section.appendChild(orbitWrapper);
        return section;
    }

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

export function setupRuntimeConfigPanel({
    initialSystemConfig,
    defaultSystemConfig,
    onSystemConfigChange,
    onResetSpecificConfig,
    onApplyGlobalToAll
}) {
    let currentSystemConfig = cloneConfig(initialSystemConfig || {});
    const defaultConfigSnapshot = cloneConfig(defaultSystemConfig || initialSystemConfig || {});
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
            setSaveStatus(saveStatus, "saving", "Estado: aplicando global a todos...");
            hideValidationBanner(validationBanner);

            if (typeof onApplyGlobalToAll === "function") {
                await onApplyGlobalToAll();
            }

            setSaveStatus(saveStatus, "saved", "Estado: global aplicado a todos");
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            setSaveStatus(saveStatus, "error", `Estado: error al aplicar global (${detail})`);
        }
    });
    resetBtn.addEventListener("click", async () => {
        try {
            setSaveStatus(saveStatus, "saving", "Estado: reiniciando parametros...");
            hideValidationBanner(validationBanner);

            currentSystemConfig = cloneConfig(defaultConfigSnapshot);
            syncConfigPanelValues(formRoot, currentSystemConfig);
            onSystemConfigChange(cloneConfig(currentSystemConfig));

            if (typeof onResetSpecificConfig === "function") {
                await onResetSpecificConfig();
            }

            setSaveStatus(saveStatus, "saved", "Estado: parametros reiniciados");
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            setSaveStatus(saveStatus, "error", `Estado: error al reiniciar (${detail})`);
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
        }
    };
}
