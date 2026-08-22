import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
    dispatchOAuthCompanionRequest,
    identityErrorMessage,
    isOAuthCompanionEnabled,
    oauthCompanionAvailability,
    oauthCompanionRequestDetail,
    oauthProviderAvailabilityMessage,
    ORBIT_IDENTITY_OAUTH_REQUEST_EVENT
} from "../../../react-ui/src/features/identity/identityPresentation.js";
import {
    canFinalizeSignedOutOAuthTransaction,
    cancelOAuthCompanionTransaction,
    cleanupCancelledOAuthTransaction,
    createOAuthCompanionTransaction,
    startTrustedOAuthCompanion
} from "../../../react-ui/src/hooks/useOrbitIdentity.js";
import { ADMIN_BOOTSTRAP_IDENTIFIER } from "../../js/features/identity/index.js";

const hookSource = readFileSync(new URL("../../../react-ui/src/hooks/useOrbitIdentity.js", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../../../react-ui/src/features/identity/IdentityAccessPanel.jsx", import.meta.url), "utf8");
const panelCss = readFileSync(new URL("../../../react-ui/src/features/identity/IdentityAccessPanel.css", import.meta.url), "utf8");

function fakeLocalIdentityService() {
    let session = Object.freeze({ identityState: "local_user", provider: "", accountId: "local-test" });
    let completeCalls = 0;
    return {
        get completeCalls() {
            return completeCalls;
        },
        getSession() {
            return session;
        },
        async storeProviderTokens(provider) {
            return Object.freeze({ provider, encrypted: true });
        },
        getProviderTokenEnvelope(provider) {
            return Object.freeze({ provider, encrypted: true });
        },
        async completeExternalIdentity({ provider }) {
            completeCalls += 1;
            session = Object.freeze({ identityState: `${provider}_user`, provider, accountId: "local-test" });
            return session;
        },
        useLocalIdentity() {
            session = Object.freeze({ identityState: "local_user", provider: "", accountId: "local-test" });
            return session;
        }
    };
}

function deferredProviderTokenIdentityService() {
    let session = Object.freeze({ identityState: "local_user", provider: "", accountId: "local-test" });
    let tokenEnvelope = null;
    let removeCalls = 0;
    let replaceWithLaterEnvelope = false;
    let releaseWrite;
    let markWriteStarted;
    const tokenWriteStarted = new Promise((resolve) => {
        markWriteStarted = resolve;
    });
    const tokenWriteRelease = new Promise((resolve) => {
        releaseWrite = resolve;
    });
    return {
        get removeCalls() {
            return removeCalls;
        },
        get tokenWriteStarted() {
            return tokenWriteStarted;
        },
        releaseTokenWrite() {
            releaseWrite();
        },
        replaceWithLaterEnvelopeDuringCompareAndSwap() {
            replaceWithLaterEnvelope = true;
        },
        getSession() {
            return session;
        },
        async storeProviderTokens(provider) {
            markWriteStarted();
            await tokenWriteRelease;
            tokenEnvelope = Object.freeze({
                schema: "orbit.identity.provider-token-envelope",
                accountId: "local-test",
                provider,
                cipher: `opaque-${provider}-transaction`
            });
            return Object.freeze({ provider, encrypted: true });
        },
        getProviderTokenEnvelope(provider) {
            return tokenEnvelope?.provider === provider ? tokenEnvelope : null;
        },
        async removeProviderTokensIfMatching(provider, expectedEnvelope) {
            if (replaceWithLaterEnvelope === true) {
                tokenEnvelope = Object.freeze({
                    schema: "orbit.identity.provider-token-envelope",
                    accountId: "local-test",
                    provider,
                    cipher: `opaque-${provider}-later-transaction`
                });
            }
            if (tokenEnvelope?.provider !== provider || tokenEnvelope !== expectedEnvelope) return false;
            return this.removeProviderTokens(provider);
        },
        async removeProviderTokens(provider) {
            if (tokenEnvelope?.provider !== provider) return false;
            tokenEnvelope = null;
            removeCalls += 1;
            if (session.provider === provider) {
                session = Object.freeze({ identityState: "local_user", provider: "", accountId: "local-test" });
            }
            return true;
        },
        async completeExternalIdentity({ provider }) {
            session = Object.freeze({ identityState: `${provider}_user`, provider, accountId: "local-test" });
            return session;
        },
        useLocalIdentity() {
            session = Object.freeze({ identityState: "local_user", provider: "", accountId: "local-test" });
            return session;
        }
    };
}

test("identity access panel matches the compact Orbit sign-in surface and keeps external actions safe", () => {
    assert.match(panelSource, /Bienvenido de nuevo/);
    assert.match(panelSource, /TU ESPACIO\. TUS ÓRBITAS\./);
    assert.match(panelSource, /Correo electrónico/);
    assert.match(panelSource, /¿Olvidaste tu contraseña\?/);
    assert.match(panelSource, /Iniciar sesión/);
    assert.match(panelSource, /Continuar con Google/);
    assert.match(panelSource, /Continuar con Microsoft/);
    assert.match(panelSource, /PROVIDERS\.map/);
    assert.match(panelSource, /disabled=\{busy \|\| !available\}/);
    assert.match(panelCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(panelSource, /Continuar solo con cuenta local/);
    assert.match(panelSource, /Tus datos se guardan cifrados en este dispositivo/);
    assert.match(panelSource, /placeholder="Password"/);
    assert.doesNotMatch(panelSource, /Configura un companion OAuth local confiable/);
    assert.doesNotMatch(panelSource, /companion/i, "the operator-facing access panel must not expose companion setup jargon");
    assert.doesNotMatch(panelSource, /availability\?\.message/);
    assert.match(panelSource, /type=\{showPassword \? "text" : "password"\}/);
    assert.match(panelSource, /Desvincular/);
    assert.doesNotMatch(panelSource, /accessToken|refreshToken|idToken/);
    assert.match(panelCss, /orbit-identity-access-panel/);
});

test("email-first access shows the password in the visual form but keeps it disabled behind a selector-only lookup", () => {
    assert.match(panelSource, /const \[screen, setScreen\] = useState\("sign-in"\)/);
    assert.match(panelSource, /identity\.checkLocalAccountAvailability\?\.\(\{ identifier \}\)/);
    assert.match(panelSource, /result\.exists === true/);
    assert.match(panelSource, /setPasswordAllowed\(true\)/);
    assert.match(panelSource, /setPasswordAllowed\(false\)/);
    assert.match(panelSource, /disabled=\{isBusy \|\| !passwordAllowed\}/);
    assert.match(panelSource, /setScreen\("register"\)/);
    assert.match(panelSource, /screen === "register"/);
    assert.match(panelSource, /identifierRef\.current !== identifier/);
    assert.match(panelSource, /Orbit no mostrará información de la cuenta/i);
    assert.match(panelSource, /Continuar/);
    assert.match(panelSource, /Reg.strate gratis/);
    assert.match(panelSource, /Crea tu espacio Orbit/);
    assert.match(panelSource, /Crear cuenta/);
    assert.match(hookSource, /const checkLocalAccountAvailability = useCallback/);
    assert.match(hookSource, /service\.getLocalAccountAvailability\(input\)/);
    assert.doesNotMatch(panelSource, /getAccount\(|getProfile\(|getUnlockedVault\(/, "an email-first panel must not read account data or unlock a vault to decide its next step");
});

test("the reserved administrator bootstrap and recovery request retain their explicit, non-enumerating access contracts", () => {
    assert.equal(ADMIN_BOOTSTRAP_IDENTIFIER, "admin@orbit.com");
    assert.match(panelSource, /isReservedAdministratorIdentifier\(fields\.identifier\)\s*\? await identity\.bootstrapAdminAccount\?\.\(fields\)/);
    assert.match(panelSource, /identity\.requestLocalPasswordReset\?\.\(\{ identifier: fields\.identifier \}\)/);
    assert.match(panelSource, /Se ha solicitado al administrador un cambio de contrase\u00f1a\./);
});

test("a forced password change remains a hard identity gate before any workspace can mount", () => {
    assert.match(panelSource, /if \(isAuthenticated && identity\.session\?\.passwordChangeRequired === true\)/);
    assert.match(panelSource, /data-testid="identity-password-change-panel"/);
    assert.match(panelSource, /identity\.changeLocalPassword\?\.\(/);
    assert.match(panelSource, /El administrador ha solicitado un cambio antes de poder abrir el espacio local\./);
});

test("identity hook is local-first, watches connectivity and delegates OAuth to a companion-owned PKCE flow", () => {
    assert.match(hookSource, /createLocalIdentityService/);
    assert.match(hookSource, /getOAuthProviderAvailability/);
    assert.match(hookSource, /unlockOrCreateLocalVault/);
    assert.match(hookSource, /requiresExternalIdentityCompletion/);
    assert.match(hookSource, /unlinkExternalIdentity/);
    assert.match(hookSource, /onlineRef\.current/);
    assert.match(hookSource, /service,/);
    assert.match(hookSource, /addEventListener\("online"/);
    assert.match(hookSource, /addEventListener\("offline"/);
    assert.match(hookSource, /dispatchOAuthCompanionRequest/);
    assert.match(hookSource, /companion\.start\.call\(companion/);
    assert.match(hookSource, /startTrustedOAuthCompanion/);
    assert.match(hookSource, /transactionId/);
    assert.match(hookSource, /AbortController/);
    assert.match(hookSource, /signal/);
    assert.match(hookSource, /OAUTH_COMPANION_INCOMPLETE/);
    assert.match(hookSource, /OAUTH_COMPANION_CANCELLED/);
    assert.match(hookSource, /service\.getSession\(\)/);
    assert.doesNotMatch(hookSource, /\bfetch\s*\(/);
    assert.doesNotMatch(hookSource, /\/api\//);
    assert.doesNotMatch(hookSource, /createPkceAuthorizationRequest/);
    assert.doesNotMatch(hookSource, /accessToken|refreshToken|idToken|codeVerifier/);
});

test("companion OAuth event contains capability only and excludes PKCE material, URLs and tokens", () => {
    const request = {
        provider: "google",
        authorizationUrl: "https://accounts.example.test/authorize?client_id=public-client&state=transaction-state",
        capability: "interactive-pkce-only",
        renewalRequired: true,
        codeVerifier: "must-never-leave-the-hook",
        state: "must-never-leave-the-hook",
        accessToken: "never",
        refreshToken: "never"
    };
    const detail = oauthCompanionRequestDetail(request);
    assert.deepEqual(detail, {
        version: 1,
        provider: "google",
        capability: "interactive-pkce-only",
        flow: "companion-owned-pkce"
    });
    assert.equal(Object.hasOwn(detail, "authorizationUrl"), false);
    assert.equal(Object.hasOwn(detail, "codeVerifier"), false);
    assert.equal(Object.hasOwn(detail, "state"), false);
    assert.equal(Object.hasOwn(detail, "accessToken"), false);
    assert.equal(Object.hasOwn(detail, "refreshToken"), false);
});

test("external OAuth requires a trusted in-process companion with a callable start function", () => {
    const baseAvailability = Object.freeze({ provider: "microsoft", available: true, capability: "interactive-pkce-only" });
    const blocked = oauthCompanionAvailability(baseAvailability, null, "microsoft");
    assert.equal(blocked.available, false);
    assert.equal(blocked.reason, "companion-unavailable");
    assert.match(oauthProviderAvailabilityMessage(blocked), /companion OAuth local/i);
    assert.equal(oauthCompanionAvailability(baseAvailability, { enabled: true, providers: ["google"] }, "microsoft").available, false);
    assert.equal(oauthCompanionAvailability(baseAvailability, { enabled: true, providers: ["microsoft"] }, "microsoft").available, false);
    assert.equal(isOAuthCompanionEnabled(true, "microsoft"), false);
    assert.equal(isOAuthCompanionEnabled({ enabled: true, start: true }, "microsoft"), false);
    const companion = { enabled: true, providers: ["microsoft"], async start() {} };
    assert.equal(isOAuthCompanionEnabled(companion, "microsoft"), true);
    assert.equal(oauthCompanionAvailability(baseAvailability, companion, "microsoft").available, true);
});

test("companion event is custom, payload-safe and never requires an Orbit backend", () => {
    const originalCustomEvent = globalThis.CustomEvent;
    const events = [];
    class TestCustomEvent {
        constructor(type, init) {
            this.type = type;
            this.detail = init?.detail;
        }
    }
    globalThis.CustomEvent = TestCustomEvent;
    try {
        const detail = dispatchOAuthCompanionRequest({
            dispatchEvent(event) {
                events.push(event);
                return true;
            }
        }, {
            provider: "microsoft",
            capability: "interactive-pkce-only",
            codeVerifier: "private",
            state: "private",
            accessToken: "never"
        });
        assert.equal(events.length, 1);
        assert.equal(events[0].type, ORBIT_IDENTITY_OAUTH_REQUEST_EVENT);
        assert.deepEqual(events[0].detail, detail);
        assert.equal(Object.hasOwn(events[0].detail, "authorizationUrl"), false);
        assert.equal(Object.hasOwn(events[0].detail, "codeVerifier"), false);
        assert.equal(Object.hasOwn(events[0].detail, "state"), false);
        assert.equal(Object.hasOwn(events[0].detail, "accessToken"), false);
    } finally {
        if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
        else globalThis.CustomEvent = originalCustomEvent;
    }
    assert.match(identityErrorMessage({ code: "EXTERNAL_PROVIDER_OFFLINE" }), /sin conexión/i);
});

test("trusted companion receives a transaction-scoped service and must complete the requested provider session", async () => {
    const service = fakeLocalIdentityService();
    const transaction = createOAuthCompanionTransaction("google");
    let received = null;
    const companion = {
        enabled: true,
        providers: ["google"],
        async start(context) {
            received = context;
            await context.service.storeProviderTokens(context.provider, { opaque: true });
            await context.service.completeExternalIdentity({ provider: context.provider });
        }
    };

    const session = await startTrustedOAuthCompanion({
        companion,
        provider: "google",
        capability: "interactive-pkce-only",
        service,
        transaction
    });

    assert.equal(session.identityState, "google_user");
    assert.equal(received.provider, "google");
    assert.equal(typeof received.transactionId, "string");
    assert.equal(received.signal.aborted, false);
    assert.notEqual(received.service, service);
    assert.equal(typeof received.service.useLocalIdentity, "undefined");
    assert.throws(
        () => received.service.getSession(),
        (error) => error?.code === "OAUTH_COMPANION_TRANSACTION_CLOSED"
    );
    await assert.rejects(
        () => received.service.storeProviderTokens("google", { opaque: true }),
        (error) => error?.code === "OAUTH_COMPANION_TRANSACTION_CLOSED"
    );
});

test("cancelling while an encrypted provider-token write is pending removes that exact local artifact", async () => {
    const service = deferredProviderTokenIdentityService();
    const transaction = createOAuthCompanionTransaction("google");
    const companion = {
        enabled: true,
        providers: ["google"],
        async start(context) {
            await context.service.storeProviderTokens(context.provider, { opaque: true });
        }
    };
    const completion = startTrustedOAuthCompanion({
        companion,
        provider: "google",
        capability: "interactive-pkce-only",
        service,
        transaction
    });

    await service.tokenWriteStarted;
    assert.equal(cancelOAuthCompanionTransaction(transaction), true);
    service.releaseTokenWrite();

    await assert.rejects(completion, (error) => error?.code === "OAUTH_COMPANION_CANCELLED");
    assert.equal(service.getProviderTokenEnvelope("google"), null);
    assert.equal(service.removeCalls, 1);
    assert.equal(service.getSession().identityState, "local_user");
});

test("cancelled cleanup preserves a newer envelope for the same provider", async () => {
    const service = deferredProviderTokenIdentityService();
    const transaction = createOAuthCompanionTransaction("google");
    const companion = {
        enabled: true,
        providers: ["google"],
        async start(context) {
            await context.service.storeProviderTokens(context.provider, { opaque: true });
        }
    };
    const completion = startTrustedOAuthCompanion({
        companion,
        provider: "google",
        capability: "interactive-pkce-only",
        service,
        transaction
    });

    await service.tokenWriteStarted;
    assert.equal(cancelOAuthCompanionTransaction(transaction), true);
    service.replaceWithLaterEnvelopeDuringCompareAndSwap();
    service.releaseTokenWrite();

    await assert.rejects(completion, (error) => error?.code === "OAUTH_COMPANION_CANCELLED");
    assert.match(service.getProviderTokenEnvelope("google")?.cipher || "", /later-transaction/);
    assert.equal(service.removeCalls, 0);
});

test("an unbound cancelled request cannot clear a later local protector artifact", async () => {
    let removeCalls = 0;
    const transaction = createOAuthCompanionTransaction("microsoft");
    transaction.cancelled = true;
    transaction.providerTokenArtifact = Object.freeze({ accountId: "local-old", provider: "microsoft", cipher: "old" });
    const service = {
        getSession() {
            return Object.freeze({ identityState: "local_user", provider: "", accountId: "local-new" });
        },
        getProviderTokenEnvelope() {
            return Object.freeze({ accountId: "local-new", provider: "microsoft", cipher: "later" });
        },
        async removeProviderTokens() {
            removeCalls += 1;
            return true;
        }
    };

    assert.equal(await cleanupCancelledOAuthTransaction(service, transaction), false);
    assert.equal(removeCalls, 0);
});

test("a signed-out request without a bound protector cannot close a later local session", () => {
    const transaction = createOAuthCompanionTransaction("google");
    transaction.signedOut = true;
    transaction.isCurrent = () => true;
    const laterSessionService = {
        getSession() {
            return Object.freeze({ identityState: "local_user", provider: "", accountId: "local-later" });
        }
    };

    assert.equal(canFinalizeSignedOutOAuthTransaction(laterSessionService, transaction), false);
    transaction.localProtectorId = "local-original";
    transaction.protectorBound = true;
    assert.equal(canFinalizeSignedOutOAuthTransaction(laterSessionService, transaction), false);
});

test("an unsuccessful companion flow rolls back the exact token and restores the local protector", async () => {
    const service = deferredProviderTokenIdentityService();
    const transaction = createOAuthCompanionTransaction("microsoft");
    const companion = {
        enabled: true,
        providers: ["microsoft"],
        async start(context) {
            const tokenWrite = context.service.storeProviderTokens(context.provider, { opaque: true });
            await service.tokenWriteStarted;
            service.releaseTokenWrite();
            await tokenWrite;
            await context.service.completeExternalIdentity({ provider: context.provider });
            throw new Error("provider callback failed after completion");
        }
    };

    await assert.rejects(
        () => startTrustedOAuthCompanion({
            companion,
            provider: "microsoft",
            capability: "interactive-pkce-only",
            service,
            transaction
        }),
        /provider callback failed after completion/
    );
    assert.equal(service.getProviderTokenEnvelope("microsoft"), null);
    assert.equal(service.removeCalls, 1);
    assert.equal(service.getSession().identityState, "local_user");
});

test("cancelling a companion transaction aborts it and rejects a late completion", async () => {
    const service = fakeLocalIdentityService();
    const transaction = createOAuthCompanionTransaction("microsoft");
    let releaseCompanion;
    let started;
    const waitForRelease = new Promise((resolve) => {
        releaseCompanion = resolve;
    });
    const companion = {
        enabled: true,
        providers: ["microsoft"],
        async start(context) {
            started = context;
            await waitForRelease;
            await context.service.completeExternalIdentity({ provider: context.provider });
        }
    };
    const completion = startTrustedOAuthCompanion({
        companion,
        provider: "microsoft",
        capability: "interactive-pkce-only",
        service,
        transaction
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started.signal.aborted, false);
    assert.equal(cancelOAuthCompanionTransaction(transaction), true);
    assert.equal(started.signal.aborted, true);
    releaseCompanion();

    await assert.rejects(completion, (error) => error?.code === "OAUTH_COMPANION_CANCELLED");
    assert.equal(service.completeCalls, 0);
    assert.equal(service.getSession().identityState, "local_user");
});
