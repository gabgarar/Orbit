import { useEffect, useMemo, useRef, useState } from "react";
import {
    getStartupWelcomePresentation,
    STARTUP_WELCOME_MINIMUM_PRESENTATION_MS
} from "../../../front/js/features/diagnostics/startupWelcomePresentation.js";

function now() {
    return Date.now();
}

/**
 * Holds the central startup screen for a short, honest warm-cache check.
 * The timer starts when the welcome experience mounts; it never substitutes
 * for the backend's explicit readiness decision.
 */
export default function useStartupWelcomePresentation({
    startup,
    diagnostics,
    availability,
    minimumDurationMs = STARTUP_WELCOME_MINIMUM_PRESENTATION_MS
} = {}) {
    const mountedAtRef = useRef(now());
    const [minimumElapsed, setMinimumElapsed] = useState(() => minimumDurationMs <= 0);

    useEffect(() => {
        const duration = Math.max(0, Number(minimumDurationMs) || 0);
        const remaining = duration - (now() - mountedAtRef.current);
        if (remaining <= 0) {
            setMinimumElapsed(true);
            return undefined;
        }
        const timer = window.setTimeout(() => setMinimumElapsed(true), remaining);
        return () => window.clearTimeout(timer);
    }, [minimumDurationMs]);

    return useMemo(() => getStartupWelcomePresentation({
        startup,
        diagnostics,
        availability,
        elapsedMs: minimumElapsed ? minimumDurationMs : now() - mountedAtRef.current,
        minimumDurationMs
    }), [availability, diagnostics, minimumDurationMs, minimumElapsed, startup]);
}
