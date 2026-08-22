/**
 * Authentication states intentionally live separately from project and sync
 * state.  A UI can therefore gate every project/module route on one small,
 * stable contract without learning how credentials are stored.
 */
export const IDENTITY_STATES = Object.freeze({
    UNAUTHENTICATED: "unauthenticated",
    LOCAL_USER: "local_user",
    GOOGLE_USER: "google_user",
    MICROSOFT_USER: "microsoft_user"
});

export const EXTERNAL_IDENTITY_STATES = Object.freeze([
    IDENTITY_STATES.GOOGLE_USER,
    IDENTITY_STATES.MICROSOFT_USER
]);

const KNOWN_STATES = new Set(Object.values(IDENTITY_STATES));
const AUTHENTICATED_STATES = new Set([
    IDENTITY_STATES.LOCAL_USER,
    ...EXTERNAL_IDENTITY_STATES
]);

export function normalizeIdentityState(value) {
    const state = String(value || "").trim().toLowerCase();
    return KNOWN_STATES.has(state) ? state : IDENTITY_STATES.UNAUTHENTICATED;
}

export function isAuthenticatedIdentityState(value) {
    return AUTHENTICATED_STATES.has(normalizeIdentityState(value));
}

export function isExternalIdentityState(value) {
    return EXTERNAL_IDENTITY_STATES.includes(normalizeIdentityState(value));
}

export function identityStateForProvider(provider) {
    const normalized = String(provider || "").trim().toLowerCase();
    if (normalized === "google") return IDENTITY_STATES.GOOGLE_USER;
    if (normalized === "microsoft") return IDENTITY_STATES.MICROSOFT_USER;
    return IDENTITY_STATES.UNAUTHENTICATED;
}
