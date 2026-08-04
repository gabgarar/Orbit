import { useEffect, useState } from "react";

export default function useConfigPanelState() {
    const [open, setOpen] = useState(false); const [config, setConfig] = useState({}); const [status, setStatus] = useState({ state: "idle", message: "Estado: sincronizado" });
    useEffect(() => {
        const onState = (event) => setConfig(event.detail?.config || {}); const onOpen = () => setOpen(true); const onClose = () => setOpen(false); const onToggle = () => setOpen((value) => !value); const onStatus = (event) => setStatus(event.detail || { state: "idle", message: "" });
        const events = [["orbit:config-panel-state", onState], ["orbit:config-panel-open", onOpen], ["orbit:config-panel-close", onClose], ["orbit:config-panel-toggle", onToggle], ["orbit:config-panel-status", onStatus]];
        events.forEach(([name, listener]) => window.addEventListener(name, listener)); return () => events.forEach(([name, listener]) => window.removeEventListener(name, listener));
    }, []);
    useEffect(() => { const onEscape = (event) => event.key === "Escape" && setOpen(false); if (open) document.addEventListener("keydown", onEscape); return () => document.removeEventListener("keydown", onEscape); }, [open]);
    return { open, setOpen, config, setConfig, status };
}
