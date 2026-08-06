function cloneConfig(value) {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

/**
 * Bridges the Cesium runtime with the React-owned configuration interface.
 *
 * The UI communicates through DOM events so the runtime remains independent
 * from React while configuration changes still use one canonical state.
 */
export function setupRuntimeConfigPanel({
    initialSystemConfig,
    defaultSystemConfig,
    onSystemConfigChange,
    onResetSpecificConfig,
    onApplyGlobalToAll,
    getUiText
}) {
    const uiTextProvider = typeof getUiText === "function" ? getUiText : () => (key) => key;
    const uiText = (key) => {
        const translator = uiTextProvider();
        return typeof translator === "function" ? translator(key) : key;
    };
    let currentSystemConfig = cloneConfig(initialSystemConfig || {});
    const defaultConfigSnapshot = cloneConfig(defaultSystemConfig || initialSystemConfig || {});

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

        currentSystemConfig = cloneConfig({
            ...currentSystemConfig,
            [section]: { ...currentSystemConfig[section], [key]: nextValue }
        });
        onSystemConfigChange(cloneConfig(currentSystemConfig));
        emitState();
        emitStatus("saved", uiText("configSavedState"));
    };

    window.addEventListener("orbit:config-panel-action", async (event) => {
        const action = event.detail || {};
        if (action.type === "change") {
            applyChange(action.section, action.key, action.value);
            return;
        }

        try {
            if (action.type === "apply-global") {
                emitStatus("saving", uiText("applyingGlobal"));
                await onApplyGlobalToAll?.();
                emitStatus("saved", uiText("globalApplied"));
            }
            if (action.type === "reset") {
                emitStatus("saving", uiText("resettingParams"));
                currentSystemConfig = cloneConfig(defaultConfigSnapshot);
                onSystemConfigChange(cloneConfig(currentSystemConfig));
                await onResetSpecificConfig?.();
                emitState();
                emitStatus("saved", uiText("paramsReset"));
            }
        } catch (error) {
            emitStatus("error", error instanceof Error ? error.message : String(error));
        }
    });

    emitState();
    emitStatus("idle", uiText("configSaved"));
    return {
        setSystemConfig(nextConfig) {
            currentSystemConfig = cloneConfig(nextConfig || {});
            emitState();
        },
        setSaveState(state, message) {
            emitStatus(state, message);
        },
        open() {
            window.dispatchEvent(new Event("orbit:config-panel-open"));
        },
        close() {
            window.dispatchEvent(new Event("orbit:config-panel-close"));
        },
        toggle() {
            window.dispatchEvent(new Event("orbit:config-panel-toggle"));
        }
    };
}
