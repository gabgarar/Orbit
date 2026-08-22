/**
 * Presentation-only helpers for the local-first identity gate.
 *
 * OAuth code exchange deliberately does not live here.  This module can only
 * describe provider capability and ask a separately configured, local
 * companion to take ownership of an interactive browser flow.
 */

export const ORBIT_IDENTITY_OAUTH_REQUEST_EVENT = "orbit:identity-oauth-request";
export const LOCAL_IDENTITY_MIN_PASSWORD_LENGTH = 12;

const PROVIDER_LABELS = Object.freeze({
    google: "Google",
    microsoft: "Microsoft"
});

const ERROR_MESSAGES = Object.freeze({
    IDENTIFIER_INVALID: "Introduce una identidad local válida, sin espacios.",
    IDENTIFIER_UNAVAILABLE: "Ya existe una cuenta local con esa identidad.",
    PASSWORD_WEAK: `La contraseña debe tener al menos ${LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} caracteres.`,
    INVALID_CREDENTIALS: "La identidad o la contraseña no son correctas.",
    ACCOUNT_LOCKED: "Esta cuenta está bloqueada. Contacta con la administración de esta instalación.",
    ACCOUNT_DELETED: "Esta cuenta ha sido eliminada por la administración de esta instalación.",
    PASSWORD_CHANGE_REQUIRED: "Debes actualizar tu contraseña antes de abrir el espacio local.",
    ADMIN_BOOTSTRAP_REQUIRED: "La cuenta administrativa inicial debe crearse mediante su configuración segura.",
    ADMIN_BOOTSTRAP_IDENTIFIER_REQUIRED: "La primera cuenta administradora local debe usar admin@orbit.com.",
    ADMIN_BOOTSTRAP_ALREADY_COMPLETED: "Esta instalación ya tiene una cuenta administradora local.",
    ADMIN_ACCESS_REQUIRED: "Esta cuenta no puede gestionar los usuarios locales.",
    ADMIN_SELF_UPDATE_FORBIDDEN: "No puedes revocar ni modificar tu propio acceso administrativo desde aquí.",
    ADMIN_SELF_DELETE_FORBIDDEN: "No puedes eliminar tu propia cuenta administradora.",
    ADMIN_LAST_ADMIN_REQUIRED: "Debe permanecer al menos una cuenta administradora local.",
    ADMIN_USER_NOT_FOUND: "No se ha encontrado el usuario local solicitado.",
    ADMIN_LOGIN_POLICY_INVALID: "El límite de intentos debe estar entre 1 y 50.",
    ADMIN_REGISTRY_UNAVAILABLE: "La administración local de usuarios no está disponible en este dispositivo.",
    DISPLAY_NAME_INVALID: "El nombre mostrado no es válido.",
    LOCAL_STORAGE_UNAVAILABLE: "Este navegador no permite el almacenamiento local necesario para crear la cuenta.",
    WEB_CRYPTO_UNAVAILABLE: "Este navegador no dispone de la protección criptográfica necesaria para cuentas locales.",
    LOCAL_VAULT_PROTECTOR_REQUIRED: "Crea o desbloquea primero el protector local de este espacio.",
    EXTERNAL_PROVIDER_OFFLINE: "Google y Microsoft no están disponibles sin conexión a Internet.",
    OAUTH_COMPANION_UNAVAILABLE: "Este acceso necesita un companion OAuth local confiable con una función de inicio configurada en este dispositivo.",
    OAUTH_COMPANION_INCOMPLETE: "El companion OAuth no ha completado una sesión segura con el proveedor.",
    OAUTH_EVENT_TARGET_UNAVAILABLE: "No se ha encontrado el companion OAuth local para continuar de forma segura.",
    OAUTH_REQUEST_FAILED: "No se ha podido preparar el acceso del proveedor en este dispositivo."
});

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

export function identityProviderLabel(provider) {
    const normalized = text(provider).toLowerCase();
    return PROVIDER_LABELS[normalized] || "Proveedor externo";
}

export function identityErrorMessage(error) {
    const code = text(error?.code);
    if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    return "No se ha podido completar la operación de identidad en este dispositivo.";
}

export function oauthProviderAvailabilityMessage(availability) {
    if (!availability?.available) {
        switch (availability?.reason) {
        case "offline":
            return "Sin conexión. Solo las cuentas locales están disponibles ahora.";
        case "companion-unavailable":
            return ERROR_MESSAGES.OAUTH_COMPANION_UNAVAILABLE;
        default:
            return "Configura un companion OAuth local confiable para habilitar este acceso en este dispositivo.";
        }
    }
    return "Se abrirá el companion OAuth local. Orbit no envía credenciales ni tokens a sus servidores.";
}

/**
 * Keeps custom-event payloads deliberately small. The configured local
 * companion owns the entire PKCE transaction, including verifier/state and
 * callback handling. Tokens, passwords, account data, authorization URLs and
 * client secrets are never put in DOM events.
 */
export function oauthCompanionRequestDetail(request) {
    const provider = text(request?.provider).toLowerCase();
    if (!PROVIDER_LABELS[provider]) {
        const error = new Error(ERROR_MESSAGES.OAUTH_REQUEST_FAILED);
        error.code = "OAUTH_REQUEST_FAILED";
        throw error;
    }
    return Object.freeze({
        version: 1,
        provider,
        capability: text(request?.capability) || "interactive-pkce-only",
        flow: "companion-owned-pkce"
    });
}

export function isOAuthCompanionEnabled(companion, provider) {
    // The event emitted below is deliberately notification-only.  A DOM
    // listener cannot be accepted as an OAuth completion path because it has
    // no trusted in-process capability to persist the encrypted token
    // envelope and complete the identity.  The host must explicitly provide
    // a callable companion instead.
    if (!companion || typeof companion !== "object" || companion.enabled !== true || typeof companion.start !== "function") return false;
    const allowedProviders = companion.providers;
    if (!Array.isArray(allowedProviders) || !allowedProviders.length) return true;
    return allowedProviders.map((candidate) => text(candidate).toLowerCase()).includes(text(provider).toLowerCase());
}

export function oauthCompanionAvailability(availability, companion, provider) {
    if (!availability?.available) return availability;
    if (isOAuthCompanionEnabled(companion, provider)) return availability;
    return Object.freeze({
        ...availability,
        available: false,
        capability: "local-companion-unavailable",
        reason: "companion-unavailable"
    });
}

export function dispatchOAuthCompanionRequest(eventTarget, request) {
    if (!eventTarget || typeof eventTarget.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") {
        const error = new Error(ERROR_MESSAGES.OAUTH_EVENT_TARGET_UNAVAILABLE);
        error.code = "OAUTH_EVENT_TARGET_UNAVAILABLE";
        throw error;
    }
    const detail = oauthCompanionRequestDetail(request);
    eventTarget.dispatchEvent(new globalThis.CustomEvent(ORBIT_IDENTITY_OAUTH_REQUEST_EVENT, { detail }));
    return detail;
}
