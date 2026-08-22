import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    filterAdministrationUsers,
    isAdministratorSession,
    MAX_LOGIN_ATTEMPTS,
    MIN_LOGIN_ATTEMPTS,
    normalizeAdministrationUser,
    normalizeMaximumLoginAttempts,
    providerLabel
} from "../../../react-ui/src/features/administration/adminPresentation.js";

const panel = readFileSync(new URL("../../../react-ui/src/features/administration/UserAdministrationPanel.jsx", import.meta.url), "utf8");
const panelCss = readFileSync(new URL("../../../react-ui/src/features/administration/UserAdministrationPanel.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");

test("the administration workspace is guarded by the exact canonical admin role", () => {
    assert.equal(isAdministratorSession({ role: "admin" }), true);
    assert.equal(isAdministratorSession({ role: "ADMIN" }), false);
    assert.equal(isAdministratorSession({ role: "operator" }), false);
    assert.equal(isAdministratorSession(null), false);
    assert.match(panel, /if \(!isAdministratorSession\(session\)\) return null/);
});

test("administration rows retain only safe user facts and distinguish a forced change from a request", () => {
    const user = normalizeAdministrationUser({
        id: "user-1",
        displayName: "Elena Vega",
        email: "elena@orbit.test",
        provider: "google",
        lastLoginAt: "2026-08-22T09:30:00.000Z",
        blocked: true,
        passwordChangeRequired: true,
        passwordResetRequested: true,
        note: "On-call operator",
        accessToken: "must-not-be-projected"
    });

    assert.deepEqual(user, {
        id: "user-1",
        displayName: "Elena Vega",
        identifier: "elena@orbit.test",
        provider: "google",
        lastLoginAt: "2026-08-22T09:30:00.000Z",
        blocked: true,
        passwordChangeRequired: true,
        passwordResetRequested: true,
        note: "On-call operator"
    });
    assert.equal(Object.hasOwn(user, "accessToken"), false);
    assert.equal(providerLabel(user.provider), "Google");
});

test("directory search matches name or email without changing administrative records", () => {
    const users = [
        { id: "1", displayName: "Ada Lovelace", email: "ada@orbit.test", provider: "local" },
        { id: "2", displayName: "Bruno Díaz", email: "bruno@orbit.test", provider: "microsoft" }
    ];
    assert.deepEqual(filterAdministrationUsers(users, "lovelace").map((user) => user.id), ["1"]);
    assert.deepEqual(filterAdministrationUsers(users, "BRUNO@").map((user) => user.id), ["2"]);
    assert.equal(users[0].blocked, undefined);
});

test("maximum login attempts are bounded before presentation while service validation remains required", () => {
    assert.equal(MAX_LOGIN_ATTEMPTS, 50);
    assert.equal(normalizeMaximumLoginAttempts(0, 5), MIN_LOGIN_ATTEMPTS);
    assert.equal(normalizeMaximumLoginAttempts(MAX_LOGIN_ATTEMPTS + 20, 5), MAX_LOGIN_ATTEMPTS);
    assert.equal(normalizeMaximumLoginAttempts("not-a-number", 7), 7);
});

test("an administrator session mounts only the administration workspace and never the viewer or project hub", () => {
    assert.match(app, /const passwordChangeRequired = identity\.session\?\.passwordChangeRequired === true/);
    assert.match(app, /const administratorWorkspace = authenticatedIdentity\s+&& identity\.session\?\.role === "admin"\s+&& !passwordChangeRequired/);
    assert.match(app, /const regularWorkspace = authenticatedIdentity\s+&& identity\.session\?\.role !== "admin"\s+&& !passwordChangeRequired/);
    assert.match(app, /const projectHub = regularWorkspace \? <UserProjectHub/);
    assert.match(app, /\{regularWorkspace && runtimeMounted && <CesiumGlobe \/>\}/);
    assert.match(app, /\{regularWorkspace && <>\s*<TopToolbar/);

    const administratorBranchStart = app.indexOf("{administratorWorkspace && <UserAdministrationPanel");
    const identityGateStart = app.indexOf("{!regularWorkspace && !administratorWorkspace && <IdentityGate");
    assert.ok(administratorBranchStart >= 0, "the dedicated administrator branch must exist");
    assert.ok(identityGateStart > administratorBranchStart, "the identity gate must follow the administrator branch");
    const administratorBranch = app.slice(administratorBranchStart, identityGateStart);
    assert.match(administratorBranch, /session=\{identity\.session\}/);
    assert.match(administratorBranch, /administration=\{identity\.administration\}/);
    assert.doesNotMatch(administratorBranch, /CesiumGlobe|TopToolbar|UserProjectHub/);
});

test("administration panel exposes required operator controls without accessing the viewer or local vault", () => {
    assert.match(panel, /Buscar correo o nombre/);
    assert.match(panel, /Último acceso/);
    assert.match(panel, /Solicitud de cambio de contraseña/);
    assert.match(panel, /Forzar cambio en próximo inicio/);
    assert.match(panel, /Notas del operador/);
    assert.match(panel, /Confirmar eliminación/);
    assert.match(panel, /Máximo de intentos fallidos/);
    assert.match(panel, /setUserNote/);
    assert.match(panel, /setPasswordChangeRequired/);
    assert.match(panel, /updateSecuritySettings/);
    assert.doesNotMatch(panel, /CesiumGlobe|UserProjectHub|getUnlockedVault|localStorage/);
    assert.match(panelCss, /orbit-admin-workspace/);
    assert.match(panelCss, /orbit-admin-directory/);
});
