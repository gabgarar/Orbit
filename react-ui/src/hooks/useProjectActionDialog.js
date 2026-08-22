import { useEffect, useState } from "react";
import {
    getStartupProjectReadiness,
    publishStartupProjectActionBlocked,
    STARTUP_STATUS_EVENT
} from "../../../front/js/features/diagnostics/startupStatus.js";
import { isAuthenticatedIdentityState } from "../../../front/js/features/identity/index.js";

export default function useProjectActionDialog() {
    const [mode, setMode] = useState(null);
    const [startupReadiness, setStartupReadiness] = useState(() => getStartupProjectReadiness(window.__orbitStartupStatus));
    const close = () => setMode(null);
    useEffect(() => {
        const open = (event) => {
            const nextMode = String(event.detail || "");
            if (nextMode !== "new" && nextMode !== "open") return;
            if (window.__orbitIdentityAccessRequired === true
                && !isAuthenticatedIdentityState(window.__orbitIdentitySession?.identityState)) {
                return;
            }
            if (!getStartupProjectReadiness(window.__orbitStartupStatus).ready) {
                publishStartupProjectActionBlocked(nextMode);
                return;
            }
            setMode(nextMode);
        };
        const closeOnRuntimeFailure = (event) => { if (event.detail?.state === "failed") close(); };
        const closeUntilStartupReady = (event) => {
            const next = getStartupProjectReadiness(event.detail || window.__orbitStartupStatus);
            setStartupReadiness(next);
            if (!next.ready) close();
        };
        window.addEventListener("orbit:project-dialog-request", open);
        window.addEventListener("orbit:runtime-status", closeOnRuntimeFailure);
        window.addEventListener(STARTUP_STATUS_EVENT, closeUntilStartupReady);
        return () => {
            window.removeEventListener("orbit:project-dialog-request", open);
            window.removeEventListener("orbit:runtime-status", closeOnRuntimeFailure);
            window.removeEventListener(STARTUP_STATUS_EVENT, closeUntilStartupReady);
        };
    }, []);
    useEffect(() => { if (!mode) return undefined; const onEscape = (event) => event.key === "Escape" && close(); document.addEventListener("keydown", onEscape); return () => document.removeEventListener("keydown", onEscape); }, [mode]);
    return { mode, close, startupReadiness };
}
