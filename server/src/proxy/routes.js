import { createPythonForwarder } from "./forwarder.js";

const API_ROUTES = ["/propagate", "/orbits", "/aos-los", "/ephemeris", "/manual-orbits"];
const SATELLITE_API_ROUTES = ["/propagate", "/orbits"];

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

    registerForwardingRoute(app, "get", "/api/export/ephemeris/:satId", (request) => (
        `/export/ephemeris/${encodeURIComponent(request.params.satId)}`
    ), forward);
    registerForwardingRoute(app, "get", "/docs*", documentationPath, forward);

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
