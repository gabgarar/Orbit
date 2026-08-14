import { useEffect, useState } from "react";
import { findDiagnosticComponent } from "../../../front/js/features/diagnostics/diagnosticsContract.js";
import {
    mergeStartupStatus,
    publishStartupStatus,
    STARTUP_STATUS_EVENT,
    STARTUP_STATUS_REQUEST_EVENT,
    startupStatusFromDiagnosticComponent
} from "../../../front/js/features/diagnostics/startupStatus.js";

function initialStartupState() {
    if (typeof window === "undefined") return mergeStartupStatus(null, { status: "pending" });
    return mergeStartupStatus(null, window.__orbitStartupStatus || {
        source: "react-ui",
        status: "pending",
        step: {
            id: "configuration",
            label: "Comprobando configuración…",
            status: "pending"
        }
    });
}

/**
 * Combines cached local milestones with the optional backend `startup`
 * component.  The latter remains authoritative for ERP/gravity operations;
 * an absent component stays pending instead of looking successful.
 */
export default function useStartupStatus({ diagnostics = null, availability = "loading" } = {}) {
    const [startup, setStartup] = useState(initialStartupState);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const receiveStartupStatus = (event) => {
            if (!event.detail || typeof event.detail !== "object") return;
            setStartup((current) => mergeStartupStatus(current, event.detail));
        };
        window.addEventListener(STARTUP_STATUS_EVENT, receiveStartupStatus);
        if (window.__orbitStartupStatus) {
            setStartup((current) => mergeStartupStatus(current, window.__orbitStartupStatus));
        }
        window.dispatchEvent(new Event(STARTUP_STATUS_REQUEST_EVENT));
        return () => window.removeEventListener(STARTUP_STATUS_EVENT, receiveStartupStatus);
    }, []);

    useEffect(() => {
        if (availability !== "available") return;
        const startupComponent = findDiagnosticComponent(diagnostics, "startup");
        if (!startupComponent) return;
        const update = startupStatusFromDiagnosticComponent(startupComponent);
        if (!update) return;
        const snapshot = publishStartupStatus({
            ...update,
            source: update.source || "system-diagnostics"
        });
        setStartup((current) => mergeStartupStatus(current, snapshot));
    }, [availability, diagnostics]);

    return startup;
}
