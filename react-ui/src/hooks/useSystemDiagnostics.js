import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    DIAGNOSTIC_ENDPOINT_CANDIDATES,
    DIAGNOSTICS_LOCAL_STATE_EVENT,
    DIAGNOSTICS_LOCAL_STATE_REQUEST_EVENT,
    DIAGNOSTICS_STATE_EVENT,
    fetchSystemDiagnostics
} from "../../../front/js/features/diagnostics/diagnosticsContract.js";

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;

function nowUtc() {
    return new Date().toISOString();
}

function initialState() {
    return {
        availability: "loading",
        endpoint: "",
        diagnostics: null,
        local: null,
        checkedAt: "",
        error: "",
        refreshing: false
    };
}

function publishDiagnosticsState(snapshot) {
    if (typeof window === "undefined") return;
    window.__orbitDiagnosticsState = snapshot;
    window.dispatchEvent(new CustomEvent(DIAGNOSTICS_STATE_EVENT, { detail: snapshot }));
}

/**
 * Polls an optional diagnostics endpoint only while its panel is mounted.
 * Scene diagnostics arrive separately from the Cesium runtime, which avoids
 * duplicate API calls and lets MTR/SP3 remain visible if a backend predates
 * the endpoint.
 */
export default function useSystemDiagnostics({ enabled = true, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
    const [state, setState] = useState(initialState);
    const mountedRef = useRef(false);
    const inFlightRef = useRef(false);
    const abortRef = useRef(null);
    const endpoints = useMemo(() => DIAGNOSTIC_ENDPOINT_CANDIDATES, []);
    const endpointsKey = endpoints.join("|");

    const requestLocalState = useCallback(() => {
        if (typeof window === "undefined") return;
        if (window.__orbitDiagnosticsLocalState) {
            setState((current) => ({ ...current, local: window.__orbitDiagnosticsLocalState }));
        }
        window.dispatchEvent(new Event(DIAGNOSTICS_LOCAL_STATE_REQUEST_EVENT));
    }, []);

    const refresh = useCallback(async () => {
        if (!enabled || inFlightRef.current || typeof window === "undefined") return null;
        inFlightRef.current = true;
        const controller = new AbortController();
        let timedOut = false;
        const timeout = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, REQUEST_TIMEOUT_MS);
        abortRef.current = controller;
        setState((current) => ({ ...current, refreshing: true }));

        try {
            const fetchImpl = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
            const result = await fetchSystemDiagnostics(fetchImpl, endpoints, { signal: controller.signal });
            if (!mountedRef.current || controller.signal.aborted) return result;
            const snapshot = {
                ...result,
                checkedAt: nowUtc()
            };
            publishDiagnosticsState(snapshot);
            setState((current) => ({ ...current, ...snapshot, refreshing: false }));
            return snapshot;
        } catch (error) {
            // An unmount abort is expected and must not overwrite a newer
            // result. A timeout becomes an actionable warning, never an
            // invented healthy endpoint state.
            if (!mountedRef.current || (!timedOut && controller.signal.aborted)) return null;
            const snapshot = {
                availability: "unavailable",
                endpoint: "",
                diagnostics: null,
                error: timedOut
                    ? "La consulta de diagn\u00f3sticos super\u00f3 8 s. Comprueba que Orbit est\u00e1 iniciado."
                    : String(error?.message || "No se pudo consultar el diagn\u00f3stico del sistema."),
                checkedAt: nowUtc()
            };
            publishDiagnosticsState(snapshot);
            setState((current) => ({ ...current, ...snapshot, refreshing: false }));
            return snapshot;
        } finally {
            window.clearTimeout(timeout);
            if (abortRef.current === controller) abortRef.current = null;
            inFlightRef.current = false;
            if (mountedRef.current) setState((current) => current.refreshing ? { ...current, refreshing: false } : current);
        }
    }, [enabled, endpoints, endpointsKey]);

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const receiveLocalState = (event) => {
            if (!event.detail || typeof event.detail !== "object") return;
            setState((current) => ({ ...current, local: event.detail }));
        };
        window.addEventListener(DIAGNOSTICS_LOCAL_STATE_EVENT, receiveLocalState);
        requestLocalState();
        return () => window.removeEventListener(DIAGNOSTICS_LOCAL_STATE_EVENT, receiveLocalState);
    }, [requestLocalState]);

    useEffect(() => {
        if (!enabled || typeof window === "undefined") return undefined;
        mountedRef.current = true;
        void refresh();
        const interval = window.setInterval(() => {
            requestLocalState();
            void refresh();
        }, Math.max(10_000, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));
        return () => {
            mountedRef.current = false;
            window.clearInterval(interval);
            abortRef.current?.abort();
        };
    }, [enabled, pollIntervalMs, refresh, requestLocalState]);

    return { ...state, refresh, requestLocalState };
}
