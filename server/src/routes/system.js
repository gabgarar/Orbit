import express from "express";
import { ACTIVE_CATALOG_FILE_KEY, preserveServerManagedData } from "../config/data-keys.js";

const DEFAULT_CATALOG_FILE = "catalog.json";

function changesActiveCatalogFile(previous, data) {
    if (!data || !Object.hasOwn(data, ACTIVE_CATALOG_FILE_KEY)) return false;
    const currentFile = String(previous?.data?.[ACTIVE_CATALOG_FILE_KEY] || DEFAULT_CATALOG_FILE);
    return data[ACTIVE_CATALOG_FILE_KEY] !== currentFile;
}

/** Register the persisted system-configuration endpoint with injected runtime services. */
export function registerSystemRoutes(app, { getConfig, saveConfig, updateConfig, sanitize, onSaved }) {
    const router = express.Router();

    router.post("/system-config", async (req, res) => {
        try {
            const payload = sanitize(req.body);
            if (!payload) {
                return res.status(400).json({ ok: false, error: "Payload invalido." });
            }

            // The active catalog path is a boot-time operational setting. The
            // browser only saves preferences and must not switch the live
            // backend to a missing or concurrently-mutated file.
            const currentConfig = payload.data && Object.hasOwn(payload.data, ACTIVE_CATALOG_FILE_KEY)
                ? await getConfig()
                : undefined;
            if (changesActiveCatalogFile(currentConfig, payload.data)) {
                return res.status(409).json({
                    ok: false,
                    error: "El archivo de catalogo activo no se puede cambiar mientras Orbit esta en ejecucion."
                });
            }

            const mergePayload = (previous) => ({
                ...previous,
                system: payload.system,
                data: payload.data === undefined
                    ? previous?.data
                    : preserveServerManagedData(previous?.data, payload.data)
            });
            const next = typeof updateConfig === "function"
                ? await updateConfig(mergePayload)
                : mergePayload(currentConfig || await getConfig());

            if (typeof updateConfig !== "function") await saveConfig(next);
            const runtimeApplied = await onSaved?.(next);
            if (runtimeApplied === false) {
                return res.status(503).json({
                    ok: false,
                    persisted: true,
                    error: "La configuracion se guardo, pero el backend de propagacion no pudo recargarse. Reinicia Orbit para aplicar los cambios."
                });
            }

            return res.json({ ok: true });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
    app.use("/api", router);
}
