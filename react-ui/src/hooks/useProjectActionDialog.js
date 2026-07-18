import { useEffect, useState } from "react";

export default function useProjectActionDialog() {
    const [mode, setMode] = useState(null);
    const close = () => setMode(null);
    useEffect(() => {
        const open = (event) => { const nextMode = String(event.detail || ""); if (nextMode === "new" || nextMode === "open") setMode(nextMode); };
        const closeOnRuntimeFailure = (event) => { if (event.detail?.state === "failed") close(); };
        window.addEventListener("orbit:project-dialog-request", open);
        window.addEventListener("orbit:runtime-status", closeOnRuntimeFailure);
        return () => {
            window.removeEventListener("orbit:project-dialog-request", open);
            window.removeEventListener("orbit:runtime-status", closeOnRuntimeFailure);
        };
    }, []);
    useEffect(() => { if (!mode) return undefined; const onEscape = (event) => event.key === "Escape" && close(); document.addEventListener("keydown", onEscape); return () => document.removeEventListener("keydown", onEscape); }, [mode]);
    return { mode, close };
}
