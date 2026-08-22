import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    createLocalIdentityService,
    getOAuthProviderAvailability,
    IDENTITY_STATES
} from "../../../front/js/features/identity/index.js";
import {
    dispatchOAuthCompanionRequest,
    identityErrorMessage,
    isOAuthCompanionEnabled,
    oauthCompanionAvailability,
    oauthProviderAvailabilityMessage
} from "../features/identity/identityPresentation.js";

const PROVIDERS = Object.freeze(["google", "microsoft"]);

function browserWindow() {
    return typeof window === "undefined" ? null : window;
}

function readOnline(override) {
    if (typeof override === "boolean") return override;
    if (typeof override === "function") {
        try {
            return override() === true;
        } catch {
            return false;
        }
    }
    return globalThis.navigator?.onLine === true;
}

function providerConfiguration(oauth, provider) {
    const candidate = oauth?.[provider];
    return candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? { ...candidate, provider }
        : { provider };
}

function providerCapabilities({ oauth, online, companion }) {
    return Object.freeze(Object.fromEntries(PROVIDERS.map((provider) => {
        const availability = getOAuthProviderAvailability(providerConfiguration(oauth, provider), { online });
        const withCompanion = oauthCompanionAvailability(availability, companion, provider);
        return [provider, Object.freeze({
            ...withCompanion,
            message: oauthProviderAvailabilityMessage(withCompanion)
        })];
    })));
}

function localVaultProtectorRequired() {
    const error = new Error("Crea o desbloquea primero el protector local de este espacio.");
    error.code = "LOCAL_VAULT_PROTECTOR_REQUIRED";
    return error;
}

function emptyAdministrationDirectory() {
    return Object.freeze({
        users: [],
        settings: Object.freeze({ maxLoginAttempts: 5 })
    });
}

function administrationUserProjection(user) {
    if (!user || typeof user !== "object") return null;
    return Object.freeze({
        ...user,
        id: user.accountId || user.id || "",
        note: user.notes || user.note || "",
        passwordResetRequested: Boolean(user.passwordResetRequested || user.passwordResetRequestedAt)
    });
}

function administrationDirectoryProjection(users, policy) {
    const maximum = Number(policy?.maxFailedAttempts);
    return Object.freeze({
        users: Object.freeze((Array.isArray(users) ? users : [])
            .map(administrationUserProjection)
            .filter(Boolean)),
        settings: Object.freeze({
            maxLoginAttempts: Number.isInteger(maximum) && maximum > 0 ? maximum : 5
        })
    });
}

function oauthCompanionUnavailable() {
    const error = new Error("Este acceso necesita un companion OAuth local configurado en este dispositivo.");
    error.code = "OAUTH_COMPANION_UNAVAILABLE";
    return error;
}

function oauthCompanionIncomplete() {
    const error = new Error("El companion OAuth no ha completado una sesión segura con el proveedor.");
    error.code = "OAUTH_COMPANION_INCOMPLETE";
    return error;
}

function oauthCompanionCancelled() {
    const error = new Error("La vinculación externa se ha cancelado.");
    error.code = "OAUTH_COMPANION_CANCELLED";
    return error;
}

function oauthCompanionTransactionClosed() {
    const error = new Error("La vinculación externa ya ha finalizado.");
    error.code = "OAUTH_COMPANION_TRANSACTION_CLOSED";
    return error;
}

function oauthCompanionOwnershipLost() {
    const error = new Error("La sesión local del companion ya no pertenece a esta solicitud.");
    error.code = "OAUTH_REQUEST_FAILED";
    return error;
}

function expectedCompanionProvider(provider) {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    if (!PROVIDERS.includes(normalizedProvider)) throw oauthCompanionUnavailable();
    return normalizedProvider;
}

let oauthTransactionSequence = 0;

/**
 * This is a cancellation boundary, not an OAuth secret.  It lets the
 * companion bind its browser/callback work to this one UI request without
 * putting verifier, state, authorization URLs, or token material in the DOM.
 */
export function createOAuthCompanionTransaction(provider) {
    const normalizedProvider = expectedCompanionProvider(provider);
    if (typeof globalThis.AbortController !== "function") throw oauthCompanionUnavailable();
    const randomPart = typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${++oauthTransactionSequence}`;
    const controller = new globalThis.AbortController();
    return {
        id: `orbit-oauth-${randomPart}`,
        provider: normalizedProvider,
        controller,
        cancelled: false,
        signedOut: false,
        failed: false,
        finalized: false,
        completed: false,
        unlockingLocalVault: false,
        localProtectorId: "",
        protectorBound: false,
        providerTokenArtifact: null,
        pendingTokenWrites: new Set(),
        // The hook sets this when it owns the request. Direct consumers of
        // startTrustedOAuthCompanion() simply rely on envelope matching.
        isCurrent: null
    };
}

export function cancelOAuthCompanionTransaction(transaction) {
    if (!transaction || transaction.cancelled === true || transaction.finalized === true) return false;
    transaction.cancelled = true;
    try {
        transaction.controller?.abort();
    } catch {
        // A failed abort call must still invalidate the transaction locally.
    }
    return true;
}

function finalizeOAuthCompanionTransaction(transaction, { completed = false } = {}) {
    if (!transaction || transaction.finalized === true) return false;
    transaction.completed = completed === true;
    transaction.finalized = true;
    return true;
}

function isOAuthCompanionTransactionActive(transaction) {
    return Boolean(transaction)
        && transaction.cancelled !== true
        && transaction.finalized !== true
        && transaction.controller?.signal?.aborted !== true;
}

function assertOAuthCompanionTransaction(transaction) {
    if (transaction?.cancelled === true || transaction?.controller?.signal?.aborted === true) {
        throw oauthCompanionCancelled();
    }
    if (!isOAuthCompanionTransactionActive(transaction)) throw oauthCompanionTransactionClosed();
}

function assertOAuthCompanionProvider(provider, expectedProvider) {
    if (expectedCompanionProvider(provider) === expectedProvider) return;
    const error = new Error("El companion OAuth intentó usar otro proveedor.");
    error.code = "OAUTH_REQUEST_FAILED";
    throw error;
}

function localProtectorIdForSession(session) {
    return String(session?.localAccountId || session?.accountId || "").trim();
}

function bindTransactionToProtector(transaction, protectorId) {
    if (!protectorId) return false;
    if (transaction?.localProtectorId && transaction.localProtectorId !== protectorId) return false;
    transaction.localProtectorId = protectorId;
    transaction.protectorBound = true;
    return true;
}

function bindTransactionToCurrentProtector(service, transaction) {
    return bindTransactionToProtector(transaction, localProtectorIdForSession(service?.getSession?.()));
}

function transactionOwnsCurrentSession(service, transaction) {
    const expected = String(transaction?.localProtectorId || transaction?.providerTokenArtifact?.accountId || "").trim();
    if (!expected || transaction?.protectorBound !== true) return false;
    return localProtectorIdForSession(service?.getSession?.()) === expected;
}

function transactionStillOwnsRequest(transaction) {
    return typeof transaction?.isCurrent !== "function" || transaction.isCurrent() === true;
}

function captureProviderTokenArtifact(service, transaction) {
    try {
        const envelope = service.getProviderTokenEnvelope(transaction.provider);
        if (!envelope) return null;
        transaction.providerTokenArtifact = envelope;
        if (!transaction.localProtectorId && envelope.accountId) {
            bindTransactionToProtector(transaction, String(envelope.accountId).trim());
        }
        bindTransactionToCurrentProtector(service, transaction);
        return envelope;
    } catch {
        return null;
    }
}

async function waitForPendingProviderTokenWrites(transaction) {
    while (transaction?.pendingTokenWrites?.size) {
        await Promise.allSettled([...transaction.pendingTokenWrites]);
    }
}

/**
 * Removes only the exact encrypted envelope written by a cancelled request.
 * A different active request/session or a different envelope wins: cleanup
 * must never erase a valid later provider link.
 */
export async function cleanupCancelledOAuthTransaction(service, transaction) {
    if ((!transaction?.cancelled && transaction?.failed !== true) || !service) return false;
    await waitForPendingProviderTokenWrites(transaction);
    const artifact = transaction.providerTokenArtifact;
    if (!artifact || !transactionStillOwnsRequest(transaction) || !transactionOwnsCurrentSession(service, transaction)) {
        return false;
    }
    try {
        // The identity core performs the equality check only after re-reading
        // the encrypted vault under its cross-instance mutation lock. Doing a
        // get-then-remove here would leave a TOCTOU window for another tab to
        // write a newer provider envelope between the two calls.
        if (typeof service.removeProviderTokensIfMatching !== "function") return false;
        return await service.removeProviderTokensIfMatching(transaction.provider, artifact);
    } catch {
        // A real logout may already have invalidated the vault capability.
        // Never revive it just to clean an artifact.
        return false;
    }
}

export function canFinalizeSignedOutOAuthTransaction(service, transaction) {
    return transaction?.signedOut === true
        && transactionStillOwnsRequest(transaction)
        && transactionOwnsCurrentSession(service, transaction);
}

async function finishSignedOutOAuthTransaction(service, transaction) {
    await cleanupCancelledOAuthTransaction(service, transaction);
    if (!canFinalizeSignedOutOAuthTransaction(service, transaction)) return false;
    try {
        return service.logout();
    } catch {
        return false;
    }
}

function returnToLocalIdentity(service, provider, transaction = null) {
    if (!transactionStillOwnsRequest(transaction)) return;
    if (!transactionOwnsCurrentSession(service, transaction)) return;
    if (service.getSession()?.provider !== provider) return;
    try {
        service.useLocalIdentity();
    } catch {
        // The service can have been signed out while the companion was still
        // resolving.  There is no session left to restore in that case.
    }
}

function transactionScopedOAuthService(service, transaction) {
    const provider = transaction.provider;
    const assertLive = () => assertOAuthCompanionTransaction(transaction);
    return Object.freeze({
        getSession() {
            assertLive();
            return service.getSession();
        },
        async storeProviderTokens(requestedProvider, tokenPayload) {
            assertLive();
            assertOAuthCompanionProvider(requestedProvider, provider);
            const write = Promise.resolve().then(() => service.storeProviderTokens(provider, tokenPayload));
            transaction.pendingTokenWrites.add(write);
            try {
                const result = await write;
                captureProviderTokenArtifact(service, transaction);
                assertLive();
                return result;
            } finally {
                transaction.pendingTokenWrites.delete(write);
            }
        },
        getProviderTokenEnvelope(requestedProvider) {
            assertLive();
            assertOAuthCompanionProvider(requestedProvider, provider);
            return service.getProviderTokenEnvelope(provider);
        },
        async completeExternalIdentity(input = {}) {
            assertLive();
            assertOAuthCompanionProvider(input.provider, provider);
            const result = await service.completeExternalIdentity({ ...input, provider });
            if (!isOAuthCompanionTransactionActive(transaction)) {
                returnToLocalIdentity(service, provider, transaction);
                throw oauthCompanionCancelled();
            }
            return result;
        }
    });
}

function notifyOAuthCompanionRequest(eventTarget, request) {
    // This event is optional observability only.  The trusted in-process
    // companion below is the sole completion route, so a missing DOM target
    // must never make an otherwise valid companion flow fail.
    if (!eventTarget || typeof eventTarget.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return null;
    try {
        return dispatchOAuthCompanionRequest(eventTarget, request);
    } catch {
        return null;
    }
}

/**
 * Invokes only a configured in-process OAuth companion.  `service` passed to
 * it is a provider- and transaction-scoped capability, so a late callback
 * cannot complete a cancelled flow or switch to another provider.
 */
export async function startTrustedOAuthCompanion({
    companion,
    provider,
    capability,
    service,
    eventTarget,
    transaction
} = {}) {
    const normalizedProvider = expectedCompanionProvider(provider);
    if (!isOAuthCompanionEnabled(companion, normalizedProvider) || !service || typeof service.getSession !== "function") {
        throw oauthCompanionUnavailable();
    }
    if (!transaction || transaction.provider !== normalizedProvider) throw oauthCompanionUnavailable();
    assertOAuthCompanionTransaction(transaction);
    bindTransactionToCurrentProtector(service, transaction);
    if (!transactionOwnsCurrentSession(service, transaction)) throw oauthCompanionOwnershipLost();
    const target = eventTarget || companion.eventTarget || browserWindow();
    notifyOAuthCompanionRequest(target, { provider: normalizedProvider, capability });
    const scopedService = transactionScopedOAuthService(service, transaction);
    try {
        await companion.start.call(companion, Object.freeze({
            provider: normalizedProvider,
            capability,
            transactionId: transaction.id,
            signal: transaction.controller.signal,
            service: scopedService
        }));
        assertOAuthCompanionTransaction(transaction);
        const completedSession = service.getSession();
        if (completedSession?.identityState !== `${normalizedProvider}_user` || completedSession?.provider !== normalizedProvider) {
            throw oauthCompanionIncomplete();
        }
        // The scoped capability is one-shot. A companion may retain its
        // context, but it cannot mutate a successfully completed session.
        finalizeOAuthCompanionTransaction(transaction, { completed: true });
        return completedSession;
    } catch (cause) {
        if (transaction?.cancelled === true || transaction?.controller?.signal?.aborted === true) {
            await cleanupCancelledOAuthTransaction(service, transaction);
            returnToLocalIdentity(service, normalizedProvider, transaction);
            throw oauthCompanionCancelled();
        }
        transaction.failed = true;
        await cleanupCancelledOAuthTransaction(service, transaction);
        returnToLocalIdentity(service, normalizedProvider, transaction);
        finalizeOAuthCompanionTransaction(transaction);
        throw cause;
    }
}

async function unlockOrCreateLocalVault(service, protector) {
    if (service.getSession()) return service.getSession();
    if (!protector || typeof protector !== "object") throw localVaultProtectorRequired();
    const identifier = String(protector.identifier || "").trim();
    const password = protector.password;
    if (!identifier || typeof password !== "string" || !password) throw localVaultProtectorRequired();
    try {
        const result = await service.registerLocalAccount({
            identifier,
            password,
            displayName: protector.displayName
        });
        return result.session;
    } catch (cause) {
        // A previously protected vault can be unlocked again without creating
        // a second account merely to link another provider.
        if (cause?.code !== "IDENTIFIER_UNAVAILABLE") throw cause;
        const result = await service.loginLocalAccount({ identifier, password });
        return result.session;
    }
}

/**
 * React adapter for the encrypted local identity core.
 *
 * The session only lives in memory. An external action first creates or
 * unlocks a local encrypted vault, then invokes an explicitly trusted local
 * companion. The companion owns PKCE and callback/token handling; this hook
 * never makes an Orbit backend request and never returns token material.
 */
export default function useOrbitIdentity({
    identityService,
    identityServiceOptions,
    oauth,
    oauthCompanion = null,
    online,
    eventTarget
} = {}) {
    const serviceRef = useRef(null);
    const onlineRef = useRef(online);
    onlineRef.current = online;
    const hostWindow = browserWindow();
    const sessionEventTarget = eventTarget || identityServiceOptions?.eventTarget || hostWindow;
    if (!serviceRef.current) {
        serviceRef.current = identityService || createLocalIdentityService({
            ...(identityServiceOptions || {}),
            ...(identityServiceOptions?.online ? {} : { online: () => readOnline(onlineRef.current) }),
            ...(sessionEventTarget ? { eventTarget: sessionEventTarget } : {})
        });
    }
    const service = serviceRef.current;
    const [session, setSession] = useState(() => service.getSession());
    const [operation, setOperation] = useState("idle");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [isOnline, setIsOnline] = useState(() => readOnline(online));
    const [externalSignInPending, setExternalSignInPending] = useState("");
    const [administrationDirectory, setAdministrationDirectory] = useState(emptyAdministrationDirectory);
    const [administrationLoading, setAdministrationLoading] = useState(false);
    const [administrationError, setAdministrationError] = useState("");
    const mountedRef = useRef(true);
    const oauthTransactionRef = useRef(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => service.subscribe((nextSession) => {
        const transaction = oauthTransactionRef.current;
        // A sign-out can race with local protector creation. Do not publish a
        // late session from that cancelled request while its cleanup finishes.
        if (transaction?.cancelled === true
            && transaction.signedOut === true
            && (transaction.unlockingLocalVault === true || transactionOwnsCurrentSession(service, transaction))) {
            return;
        }
        // If a companion callback races with a local cancellation, immediately
        // restore the local protector and never publish the external session
        // into React/app state.
        if (transaction?.cancelled === true && nextSession?.provider === transaction.provider) {
            returnToLocalIdentity(service, transaction.provider, transaction);
            return;
        }
        if (mountedRef.current) setSession(nextSession);
    }), [service]);

    useEffect(() => () => {
        const transaction = oauthTransactionRef.current;
        if (!cancelOAuthCompanionTransaction(transaction)) return;
        returnToLocalIdentity(service, transaction.provider, transaction);
        void cleanupCancelledOAuthTransaction(service, transaction);
    }, [service]);

    useEffect(() => {
        if (!externalSignInPending) return;
        if (session?.identityState === `${externalSignInPending}_user`) setExternalSignInPending("");
    }, [externalSignInPending, session?.identityState]);

    useEffect(() => {
        const updateOnline = () => setIsOnline(readOnline(online));
        updateOnline();
        const target = browserWindow();
        if (!target || typeof target.addEventListener !== "function" || typeof online === "boolean") return undefined;
        target.addEventListener("online", updateOnline);
        target.addEventListener("offline", updateOnline);
        return () => {
            target.removeEventListener("online", updateOnline);
            target.removeEventListener("offline", updateOnline);
        };
    }, [online]);

    const providers = useMemo(() => providerCapabilities({
        oauth,
        online: isOnline,
        companion: oauthCompanion
    }), [isOnline, oauth, oauthCompanion]);

    const run = useCallback(async (nextOperation, work, successNotice = "") => {
        setOperation(nextOperation);
        setError("");
        setNotice("");
        try {
            const result = await work();
            if (mountedRef.current && successNotice) setNotice(successNotice);
            return result;
        } catch (cause) {
            if (mountedRef.current && cause?.code !== "OAUTH_COMPANION_CANCELLED") setError(identityErrorMessage(cause));
            return null;
        } finally {
            if (mountedRef.current) setOperation("idle");
        }
    }, []);

    const refreshAdministration = useCallback(async () => {
        if (service.getSession()?.role !== "admin") {
            if (mountedRef.current) {
                setAdministrationDirectory(emptyAdministrationDirectory());
                setAdministrationError("");
                setAdministrationLoading(false);
            }
            return emptyAdministrationDirectory();
        }
        if (mountedRef.current) {
            setAdministrationLoading(true);
            setAdministrationError("");
        }
        try {
            const [users, policy] = await Promise.all([
                service.listAdministrativeUsers(),
                service.getAdministrativeLoginPolicy()
            ]);
            const directory = administrationDirectoryProjection(users, policy);
            if (mountedRef.current) setAdministrationDirectory(directory);
            return directory;
        } catch (cause) {
            if (mountedRef.current) setAdministrationError(identityErrorMessage(cause));
            throw cause;
        } finally {
            if (mountedRef.current) setAdministrationLoading(false);
        }
    }, [service]);

    const runAdministration = useCallback(async (nextOperation, work) => {
        setOperation(nextOperation);
        setError("");
        setNotice("");
        setAdministrationError("");
        try {
            const result = await work();
            await refreshAdministration();
            return result;
        } catch (cause) {
            if (mountedRef.current) {
                const message = identityErrorMessage(cause);
                setError(message);
                setAdministrationError(message);
            }
            throw cause;
        } finally {
            if (mountedRef.current) setOperation("idle");
        }
    }, [refreshAdministration]);

    const createLocalAccount = useCallback((input) => run(
        "creating-local-account",
        () => service.registerLocalAccount(input),
        "Cuenta local creada y abierta en este dispositivo."
    ), [run, service]);

    const bootstrapAdminAccount = useCallback((input) => run(
        "bootstrapping-administrator",
        () => service.bootstrapAdminAccount(input),
        "Administración local creada en este dispositivo."
    ), [run, service]);

    const loginLocalAccount = useCallback((input) => run(
        "logging-in-local-account",
        () => service.loginLocalAccount(input),
        "Sesión local iniciada en este dispositivo."
    ), [run, service]);

    // This local selector probe never unlocks an account vault or exposes a
    // profile to the access panel.
    const checkLocalAccountAvailability = useCallback((input) => run(
        "checking-local-account",
        () => service.getLocalAccountAvailability(input)
    ), [run, service]);

    const requestLocalPasswordReset = useCallback((input) => run(
        "requesting-local-password-reset",
        () => service.requestLocalPasswordReset(input),
        "Se ha solicitado al administrador un cambio de contraseña."
    ), [run, service]);

    const changeLocalPassword = useCallback((input) => run(
        "changing-local-password",
        () => service.changeLocalPassword(input),
        "La contraseña local se ha actualizado."
    ), [run, service]);

    const signOut = useCallback(() => {
        const transaction = oauthTransactionRef.current;
        const didHaveSession = Boolean(service.getSession());
        if (transaction) {
            transaction.signedOut = true;
            cancelOAuthCompanionTransaction(transaction);
            // Keep the transaction reference until it has observed its own
            // cancellation. This prevents an old cleanup from touching a
            // later request, while React closes the workspace immediately.
            void finishSignedOutOAuthTransaction(service, transaction);
        } else {
            service.logout();
        }
        setSession(null);
        setExternalSignInPending("");
        setError("");
        setNotice((didHaveSession || transaction)
            ? "Sesión cerrada en este dispositivo. La cuenta y los proyectos locales no se han eliminado."
            : "");
        return didHaveSession || Boolean(transaction);
    }, [service]);

    const requestProviderSignIn = useCallback((provider, localVaultProtector) => {
        const normalizedProvider = String(provider || "").trim().toLowerCase();
        const availability = providers[normalizedProvider];
        if (!availability?.available) {
            setError(availability?.message || "Este proveedor no está disponible en este momento.");
            return Promise.resolve(null);
        }
        return run("requesting-oauth", async () => {
            const transaction = createOAuthCompanionTransaction(normalizedProvider);
            oauthTransactionRef.current = transaction;
            transaction.isCurrent = () => oauthTransactionRef.current === transaction;
            bindTransactionToCurrentProtector(service, transaction);
            // Gate the workspace before any asynchronous local-vault work. A
            // freshly created protector briefly produces a local session, and
            // that intermediate state must not mount the workspace while this
            // provider transaction is still unresolved.
            if (mountedRef.current) setExternalSignInPending(normalizedProvider);
            try {
                transaction.unlockingLocalVault = true;
                const unlockedSession = await unlockOrCreateLocalVault(service, localVaultProtector);
                bindTransactionToProtector(transaction, localProtectorIdForSession(unlockedSession));
                transaction.unlockingLocalVault = false;
                assertOAuthCompanionTransaction(transaction);
                return await startTrustedOAuthCompanion({
                    companion: oauthCompanion,
                    provider: normalizedProvider,
                    capability: availability.capability,
                    service,
                    eventTarget,
                    transaction
                });
            } finally {
                // Account creation/unlocking is intentionally asynchronous.
                // If the user signed out while it was pending, make that
                // explicit intent win even if the local service completed a
                // late activation just before this continuation resumed.
                transaction.unlockingLocalVault = false;
                if (canFinalizeSignedOutOAuthTransaction(service, transaction)) {
                    service.logout();
                }
                if (oauthTransactionRef.current === transaction) oauthTransactionRef.current = null;
                if (mountedRef.current) {
                    setExternalSignInPending((current) => current === normalizedProvider ? "" : current);
                }
            }
        }, `La vinculación segura con ${availability.provider === "google" ? "Google" : "Microsoft"} se ha completado.`);
    }, [eventTarget, oauthCompanion, providers, run, service]);

    const cancelExternalSignIn = useCallback(() => {
        const transaction = oauthTransactionRef.current;
        if (cancelOAuthCompanionTransaction(transaction)) {
            returnToLocalIdentity(service, transaction.provider, transaction);
            void cleanupCancelledOAuthTransaction(service, transaction);
        }
        setExternalSignInPending("");
        setError("");
        setNotice("Se ha cancelado la vinculación externa. Puedes continuar únicamente con la cuenta local.");
    }, [service]);

    // Provider removal is an explicit local action. The core clears the
    // encrypted envelope and, when needed, returns the active session to its
    // local vault protector; it never contacts a provider or Orbit.
    const unlinkExternalIdentity = useCallback(() => {
        const provider = String(service.getSession()?.provider || "").trim().toLowerCase();
        if (!PROVIDERS.includes(provider)) return Promise.resolve(false);
        return run("unlinking-oauth", async () => {
            const removed = await service.removeProviderTokens(provider);
            if (!removed) throw new Error("No hay una vinculacion externa que eliminar.");
            return true;
        }, `Se ha desvinculado ${provider === "google" ? "Google" : "Microsoft"} y se han eliminado sus tokens locales.`);
    }, [run, service]);

    const searchAdministrativeUsers = useCallback(async () => refreshAdministration(), [refreshAdministration]);

    const updateAdministrativeUser = useCallback((accountId, patch = {}) => {
        const normalizedPatch = {
            ...patch,
            ...(Object.prototype.hasOwnProperty.call(patch, "note") ? { notes: patch.note } : {})
        };
        delete normalizedPatch.note;
        return runAdministration("updating-administrative-user", () => service.updateAdministrativeUser({
            accountId,
            ...normalizedPatch
        }));
    }, [runAdministration, service]);

    const setAdministrativeUserNote = useCallback((accountId, note) => runAdministration(
        "updating-administrative-note",
        () => service.updateAdministrativeUser({ accountId, notes: note })
    ), [runAdministration, service]);

    const setAdministrativePasswordChangeRequired = useCallback((accountId, required) => {
        if (required === true) {
            return runAdministration("forcing-local-password-change", () => service.forcePasswordChange({ accountId }));
        }
        return runAdministration("clearing-local-password-change", () => service.updateAdministrativeUser({
            accountId,
            passwordChangeRequired: false
        }));
    }, [runAdministration, service]);

    const clearAdministrativePasswordResetRequest = useCallback((accountId) => runAdministration(
        "clearing-local-password-reset-request",
        () => service.clearLocalPasswordResetRequest({ accountId })
    ), [runAdministration, service]);

    const deleteAdministrativeUser = useCallback((accountId) => runAdministration(
        "deleting-administrative-user",
        () => service.deleteAdministrativeUser({ accountId })
    ), [runAdministration, service]);

    const updateAdministrativeSecuritySettings = useCallback(({ maxLoginAttempts } = {}) => runAdministration(
        "updating-administrative-login-policy",
        () => service.setAdministrativeLoginPolicy({ maxFailedAttempts: maxLoginAttempts })
    ), [runAdministration, service]);

    useEffect(() => {
        if (session?.role !== "admin") {
            setAdministrationDirectory(emptyAdministrationDirectory());
            setAdministrationError("");
            setAdministrationLoading(false);
            return undefined;
        }
        void refreshAdministration().catch(() => {});
        return undefined;
    }, [refreshAdministration, session?.accountId, session?.localAccountId, session?.role]);

    const identityState = session?.identityState || IDENTITY_STATES.UNAUTHENTICATED;
    return Object.freeze({
        // This local service composes the authenticated workspace.  The
        // companion never receives it directly: startTrustedOAuthCompanion()
        // gives it a provider- and transaction-scoped capability instead.
        service,
        session,
        identityState,
        isAuthenticated: identityState !== IDENTITY_STATES.UNAUTHENTICATED,
        operation,
        busy: operation !== "idle",
        error,
        notice,
        isOnline,
        externalSignInPending,
        requiresExternalIdentityCompletion: Boolean(externalSignInPending),
        providers,
        createLocalAccount,
        bootstrapAdminAccount,
        loginLocalAccount,
        checkLocalAccountAvailability,
        requestLocalPasswordReset,
        changeLocalPassword,
        requestProviderSignIn,
        cancelExternalSignIn,
        unlinkExternalIdentity,
        signOut,
        administration: Object.freeze({
            users: administrationDirectory.users,
            settings: administrationDirectory.settings,
            loading: administrationLoading,
            busy: operation !== "idle",
            error: administrationError,
            refresh: refreshAdministration,
            searchUsers: searchAdministrativeUsers,
            updateUser: updateAdministrativeUser,
            setUserNote: setAdministrativeUserNote,
            deleteUser: deleteAdministrativeUser,
            setPasswordChangeRequired: setAdministrativePasswordChangeRequired,
            clearPasswordResetRequest: clearAdministrativePasswordResetRequest,
            updateSecuritySettings: updateAdministrativeSecuritySettings
        }),
        clearFeedback() {
            setError("");
            setNotice("");
        }
    });
}
