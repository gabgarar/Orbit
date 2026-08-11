import { createPythonForwarder } from "./forwarder.js";
import express from "express";

const API_ROUTES = ["/propagate", "/orbits", "/aos-los", "/ephemeris", "/manual-orbits", "/orbit-parameters"];
const SATELLITE_API_ROUTES = ["/propagate", "/orbits"];
export const PRECISE_PRODUCT_IMPORT_JSON_LIMIT = "90mb";

function registerForwardingRoute(app, method, route, getPythonPath, forward) {
    app[method](route, (request, response) => forward(request, response, getPythonPath(request)));
}

function documentationPath(request) {
    return `/docs${String(request.path || "").replace(/^\/docs/, "")}`;
}

function satellitePath(route, request) {
    return `${route}/${encodeURIComponent(request.params.satId)}`;
}

export function registerPythonProxyRoutes(app, client) {
    const forward = createPythonForwarder(client);

    registerForwardingRoute(app, "post", "/api/export/manual-ephemeris", () => "/export/manual-ephemeris", forward);
    registerForwardingRoute(app, "post", "/api/ground-stations/export", () => "/ground-stations/export", forward);
    registerForwardingRoute(app, "get", "/api/export/ephemeris/:satId", (request) => (
        `/export/ephemeris/${encodeURIComponent(request.params.satId)}`
    ), forward);
    registerForwardingRoute(app, "get", "/docs*", documentationPath, forward);
    // Product metadata is backed by the Python runtime rather than the Node
    // TLE catalogue. GET remains small and uses the normal app JSON parser.
    registerForwardingRoute(app, "get", "/api/precise-products", () => "/precise-products", forward);

    for (const route of ["/openapi.json", "/redoc"]) {
        registerForwardingRoute(app, "get", route, () => route, forward);
    }

    for (const route of API_ROUTES) {
        registerForwardingRoute(app, "get", `/api${route}`, () => route, forward);
        registerForwardingRoute(app, "post", `/api${route}`, () => route, forward);
    }

    for (const route of SATELLITE_API_ROUTES) {
        registerForwardingRoute(app, "get", `/api${route}/:satId`, (request) => satellitePath(route, request), forward);
    }
}

/**
 * Register the one intentionally larger parser before the generic 25 MiB
 * parser. SP3/CLK pairs are uploaded as base64, so a 64 MiB binary aggregate
 * needs headroom without relaxing the body limit for every other API.
 */
export function registerPreciseProductImportBodyParser(app) {
    app.use("/api/precise-products", express.json({ limit: PRECISE_PRODUCT_IMPORT_JSON_LIMIT }));
}

export function registerPreciseProductImportProxyRoute(app, client) {
    const forward = createPythonForwarder(client);
    // Preview accepts the same potentially large SP3/companion upload body
    // as import, but FastAPI only parses it and does not mutate project
    // state. Keep it on this bounded route rather than the generic JSON API.
    app.post("/api/precise-products/preview", (request, response) => forward(request, response, "/precise-products/preview"));
    app.post("/api/precise-products/import", (request, response) => forward(request, response, "/precise-products/import"));
}
