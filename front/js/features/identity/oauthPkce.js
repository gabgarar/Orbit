/**
 * Browser-side OAuth 2.0 PKCE request preparation only.
 *
 * These helpers never contact Google or Microsoft, exchange an authorization
 * code, refresh a token, or accept a client secret.  They are intentionally
 * conservative: a browser-only client can initiate an interactive provider
 * sign-in where its registered redirect URI permits it, but it must not claim
 * durable offline refresh semantics.  In particular, an SPA's provider token
 * lifetime and renewal policy remain provider-controlled.
 */

export const OAUTH_PROVIDERS = Object.freeze({
    GOOGLE: "google",
    MICROSOFT: "microsoft"
});

export const OAUTH_PROVIDER_DEFAULTS = Object.freeze({
    [OAUTH_PROVIDERS.GOOGLE]: Object.freeze({
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenEndpoint: "https://oauth2.googleapis.com/token",
        scopes: Object.freeze(["openid", "email", "profile"])
    }),
    [OAUTH_PROVIDERS.MICROSOFT]: Object.freeze({
        authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        scopes: Object.freeze(["openid", "profile", "email"])
    })
});

export const OAUTH_PROVIDER_CAPABILITIES = Object.freeze({
    INTERACTIVE_PKCE_ONLY: "interactive-pkce-only",
    RENEWAL_REQUIRED: "renewal-required",
    OFFLINE_UNAVAILABLE: "offline-unavailable",
    CONFIGURATION_INVALID: "configuration-invalid"
});

const encoder = new TextEncoder();

export class OAuthPkceError extends Error {
    constructor(code, message = "La configuración OAuth local no es válida.") {
        super(message);
        this.name = "OAuthPkceError";
        this.code = code;
    }
}

function fail(code, message) {
    throw new OAuthPkceError(code, message);
}

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function providerName(value) {
    const provider = text(value).toLowerCase();
    if (!Object.values(OAUTH_PROVIDERS).includes(provider)) {
        fail("OAUTH_PROVIDER_UNSUPPORTED", "El proveedor OAuth no está admitido.");
    }
    return provider;
}

function base64UrlEncode(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    const encoded = typeof globalThis.btoa === "function"
        ? globalThis.btoa(binary)
        : globalThis.Buffer?.from(bytes).toString("base64");
    if (!encoded) fail("WEB_CRYPTO_UNAVAILABLE", "El navegador no puede preparar OAuth PKCE.");
    return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function resolveWebCrypto(cryptoRef = globalThis.crypto) {
    if (!cryptoRef || !cryptoRef.subtle || typeof cryptoRef.getRandomValues !== "function") {
        fail("WEB_CRYPTO_UNAVAILABLE", "Web Crypto es necesario para OAuth PKCE.");
    }
    return cryptoRef;
}

function randomUrlSafeString(byteLength, cryptoRef) {
    const bytes = new Uint8Array(byteLength);
    resolveWebCrypto(cryptoRef).getRandomValues(bytes);
    return base64UrlEncode(bytes);
}

function validHttpsEndpoint(value, label) {
    let url;
    try {
        url = new URL(text(value));
    } catch {
        fail("OAUTH_ENDPOINT_INVALID", `${label} no es una URL HTTPS válida.`);
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
        fail("OAUTH_ENDPOINT_INVALID", `${label} debe ser una URL HTTPS sin credenciales.`);
    }
    return url.toString();
}

function validRedirectUri(value) {
    let url;
    try {
        url = new URL(text(value));
    } catch {
        fail("OAUTH_REDIRECT_INVALID", "La URI de redirección OAuth no es válida.");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.hash) {
        fail("OAUTH_REDIRECT_INVALID", "La URI de redirección debe usar HTTPS o un loopback local HTTP.");
    }
    return url.toString();
}

function validClientId(value) {
    const clientId = text(value);
    if (clientId.length < 3 || clientId.length > 512 || /\s/u.test(clientId)) {
        fail("OAUTH_CLIENT_ID_INVALID", "El client id OAuth no es válido.");
    }
    return clientId;
}

function normalizedScopes(value, fallback) {
    const candidates = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(/\s+/u)
            : fallback;
    const scopes = [...new Set(candidates.map((scope) => text(scope)).filter(Boolean))];
    if (!scopes.length || scopes.some((scope) => scope.length > 160 || !/^[A-Za-z0-9._:/-]+$/u.test(scope))) {
        fail("OAUTH_SCOPES_INVALID", "Los scopes OAuth no son válidos.");
    }
    return scopes;
}

function assertNoClientSecret(config) {
    const source = config && typeof config === "object" ? config : {};
    if (["clientSecret", "client_secret", "secret"].some((key) => Object.prototype.hasOwnProperty.call(source, key))) {
        fail("OAUTH_CLIENT_SECRET_FORBIDDEN", "Un cliente OAuth local no puede incluir un client secret.");
    }
}

/** Validate a public PKCE configuration without making a network request. */
export function validateOAuthPkceConfiguration(config = {}) {
    assertNoClientSecret(config);
    const provider = providerName(config.provider);
    const defaults = OAUTH_PROVIDER_DEFAULTS[provider];
    return Object.freeze({
        provider,
        clientId: validClientId(config.clientId),
        redirectUri: validRedirectUri(config.redirectUri),
        authorizationEndpoint: validHttpsEndpoint(config.authorizationEndpoint || defaults.authorizationEndpoint, "El endpoint de autorización"),
        tokenEndpoint: validHttpsEndpoint(config.tokenEndpoint || defaults.tokenEndpoint, "El endpoint de token"),
        scopes: Object.freeze(normalizedScopes(config.scopes, defaults.scopes))
    });
}

export function validatePkceCodeVerifier(value) {
    const verifier = text(value);
    if (!/^[A-Za-z0-9\-._~]{43,128}$/u.test(verifier)) {
        fail("PKCE_VERIFIER_INVALID", "El verifier PKCE debe tener entre 43 y 128 caracteres URL seguros.");
    }
    return verifier;
}

export function validateOAuthState(value) {
    const state = text(value);
    if (!/^[A-Za-z0-9\-._~]{16,512}$/u.test(state)) {
        fail("OAUTH_STATE_INVALID", "El estado OAuth debe ser un valor URL seguro de al menos 16 caracteres.");
    }
    return state;
}

export async function pkceCodeChallenge(codeVerifier, cryptoRef = globalThis.crypto) {
    const verifier = validatePkceCodeVerifier(codeVerifier);
    const crypto = resolveWebCrypto(cryptoRef);
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
    return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Creates an interactive authorization URL and its transient verifier/state.
 * Keep the returned verifier only in memory or a short-lived protected
 * transaction store until callback validation; it is not a provider token.
 */
export async function createPkceAuthorizationRequest(config = {}, {
    codeVerifier,
    state,
    crypto = globalThis.crypto,
    extraParameters = {}
} = {}) {
    const normalizedConfig = validateOAuthPkceConfiguration(config);
    const verifier = codeVerifier === undefined ? randomUrlSafeString(64, crypto) : validatePkceCodeVerifier(codeVerifier);
    const csrfState = state === undefined ? randomUrlSafeString(32, crypto) : validateOAuthState(state);
    const extras = extraParameters && typeof extraParameters === "object" && !Array.isArray(extraParameters) ? extraParameters : null;
    if (!extras) fail("OAUTH_PARAMETERS_INVALID", "Los parámetros OAuth adicionales no son válidos.");
    const protectedNames = new Set(["client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge", "code_challenge_method"]);
    if (Object.keys(extras).some((key) => protectedNames.has(key) || /secret|token/i.test(key))) {
        fail("OAUTH_PARAMETERS_INVALID", "Los parámetros OAuth no pueden sustituir PKCE ni incluir secretos/tokens.");
    }
    const authorizationUrl = new URL(normalizedConfig.authorizationEndpoint);
    authorizationUrl.searchParams.set("client_id", normalizedConfig.clientId);
    authorizationUrl.searchParams.set("redirect_uri", normalizedConfig.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", normalizedConfig.scopes.join(" "));
    authorizationUrl.searchParams.set("state", csrfState);
    authorizationUrl.searchParams.set("code_challenge", await pkceCodeChallenge(verifier, crypto));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    Object.entries(extras).forEach(([key, value]) => {
        if (typeof value !== "string" || !value.trim()) fail("OAUTH_PARAMETERS_INVALID", "Un parámetro OAuth adicional no es válido.");
        authorizationUrl.searchParams.set(key, value.trim());
    });
    return Object.freeze({
        provider: normalizedConfig.provider,
        authorizationUrl: authorizationUrl.toString(),
        codeVerifier: verifier,
        state: csrfState,
        codeChallengeMethod: "S256",
        // This status prevents UI/features from suggesting that code exchange
        // grants an evergreen offline sync token in a browser-only deployment.
        capability: OAUTH_PROVIDER_CAPABILITIES.INTERACTIVE_PKCE_ONLY,
        renewalRequired: true
    });
}

/** Parse a callback locally and ensure it belongs to the PKCE transaction. */
export function validatePkceAuthorizationCallback(callback, expectedState) {
    const parameters = callback instanceof URLSearchParams
        ? callback
        : typeof callback === "string"
            ? new URL(callback, "https://orbit.invalid").searchParams
            : callback && typeof callback === "object"
                ? new URLSearchParams(callback)
                : null;
    if (!parameters) fail("OAUTH_CALLBACK_INVALID", "La respuesta OAuth no es válida.");
    const returnedState = text(parameters.get("state"));
    if (!returnedState || returnedState !== validateOAuthState(expectedState)) {
        fail("OAUTH_STATE_MISMATCH", "La respuesta OAuth no coincide con la transacción iniciada.");
    }
    const providerError = text(parameters.get("error"));
    if (providerError) {
        fail("OAUTH_PROVIDER_DENIED", "El proveedor OAuth ha rechazado o cancelado el acceso.");
    }
    const code = text(parameters.get("code"));
    if (!code) fail("OAUTH_CALLBACK_INVALID", "La respuesta OAuth no contiene un código de autorización.");
    return Object.freeze({ code, state: returnedState });
}

function onlineStatus({ online, navigatorRef = globalThis.navigator } = {}) {
    if (typeof online === "boolean") return online;
    // Fail closed when a host cannot establish browser network state.  A true
    // navigator.onLine means only that a network is configured; it never
    // promises that OAuth will reach the provider.
    return navigatorRef?.onLine === true;
}

/**
 * Availability is a UI capability signal, not proof of provider reachability.
 * When offline (or network state is unknown), external sign-in is disabled and
 * local accounts remain the only supported route.
 */
export function getOAuthProviderAvailability(config, options = {}) {
    let provider = "";
    try {
        provider = providerName(config?.provider);
    } catch (error) {
        return Object.freeze({
            provider: text(config?.provider).toLowerCase(),
            available: false,
            capability: OAUTH_PROVIDER_CAPABILITIES.CONFIGURATION_INVALID,
            reason: error.code || "configuration-invalid"
        });
    }
    if (!onlineStatus(options)) {
        return Object.freeze({
            provider,
            available: false,
            capability: OAUTH_PROVIDER_CAPABILITIES.OFFLINE_UNAVAILABLE,
            reason: "offline",
            renewalRequired: true
        });
    }
    try {
        validateOAuthPkceConfiguration(config);
    } catch (error) {
        return Object.freeze({
            provider,
            available: false,
            capability: OAUTH_PROVIDER_CAPABILITIES.CONFIGURATION_INVALID,
            reason: error.code || "configuration-invalid"
        });
    }
    return Object.freeze({
        provider,
        available: true,
        capability: OAUTH_PROVIDER_CAPABILITIES.INTERACTIVE_PKCE_ONLY,
        renewalRequired: true,
        reason: "interactive-sign-in-required"
    });
}
