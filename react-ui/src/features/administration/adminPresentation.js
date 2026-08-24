/**
 * Presentation contract for the separate administrator workspace.
 *
 * The identity core remains the source of authorization and persistence. This
 * module intentionally accepts only already-authorized, redacted user records
 * from an administration hook: it never reads identity vaults or browser
 * storage itself.
 */

const ADMIN_ROLE = "admin";
export const USER_PROVIDER = Object.freeze({
    LOCAL: "local",
    GOOGLE: "google",
    MICROSOFT: "microsoft"
});
export const MIN_LOGIN_ATTEMPTS = 1;
// Keep this presentation constraint aligned with the fail-closed service
// policy. The UI is only a convenience; the core validates it again.
export const MAX_LOGIN_ATTEMPTS = 50;

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Login counters are administrative metadata, but they still cross the UI
 * boundary. Keep them finite, whole and non-negative before rendering them.
 *
 * @public Stable presentation contract covered by the administration tests.
 */
export function normalizeLoginAttemptCount(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, 1_000);
}

export function isAdministratorSession(session) {
    // This is intentionally strict. A casing or display-label variation must
    // never mount the privileged UI by accident; the identity hook emits the
    // canonical role only after authorizing the session.
    return session?.role === ADMIN_ROLE;
}

function normalizeUserProvider(value) {
    const provider = text(value).toLowerCase();
    if (provider === USER_PROVIDER.GOOGLE) return USER_PROVIDER.GOOGLE;
    if (provider === USER_PROVIDER.MICROSOFT) return USER_PROVIDER.MICROSOFT;
    return USER_PROVIDER.LOCAL;
}

export function providerLabel(provider) {
    switch (normalizeUserProvider(provider)) {
    case USER_PROVIDER.GOOGLE:
        return "Google";
    case USER_PROVIDER.MICROSOFT:
        return "Microsoft";
    default:
        return "Local";
    }
}

/**
 * Normalizes the deliberately small administration-user projection. Unknown
 * properties are ignored so the UI cannot accidentally render token, password
 * or encrypted-vault fields added by a future service.
 *
 * @public Stable redacted-user projection contract covered by the administration tests.
 */
export function normalizeAdministrationUser(value) {
    const source = object(value);
    const id = text(source.id || source.userId || source.accountId);
    if (!id) return null;
    const identifier = text(source.email || source.identifier || source.username);
    const displayName = text(source.displayName || source.name) || identifier || "Usuario sin nombre";
    // A forced next-login change and a user support request are distinct
    // operator states. Never collapse them into a single warning: one may be
    // resolved while the other still legitimately applies.
    const passwordChangeRequired = source.passwordChangeRequired === true;
    const passwordResetRequested = source.passwordResetRequested === true
        || source.passwordChangeRequested === true;
    return Object.freeze({
        id,
        displayName,
        identifier,
        provider: normalizeUserProvider(source.provider || source.identityProvider || source.type),
        lastLoginAt: text(source.lastLoginAt || source.lastAuthenticatedAt || source.lastSignInAt),
        // `failedLoginAttempts` is the live streak. The second field is a
        // historical snapshot taken immediately before the latest successful
        // sign-in clears that streak. Accept the legacy aliases only at this
        // redacted presentation boundary.
        failedLoginAttempts: normalizeLoginAttemptCount(
            source.failedLoginAttempts ?? source.currentFailedLoginAttempts,
            0
        ),
        failedLoginAttemptsAtLastSuccess: normalizeLoginAttemptCount(
            source.failedLoginAttemptsAtLastSuccess
                ?? source.failedLoginAttemptsBeforeLastSuccess
                ?? source.lastSuccessfulLoginFailedAttempts,
            0
        ),
        blocked: source.blocked === true || source.locked === true,
        passwordChangeRequired,
        passwordResetRequested,
        note: text(source.note || source.adminNote)
    });
}

export function normalizeAdministrationUsers(users) {
    const normalized = Array.isArray(users)
        ? users.map(normalizeAdministrationUser).filter(Boolean)
        : [];
    return Object.freeze([...normalized].sort((left, right) => (
        left.displayName.localeCompare(right.displayName, "es", { sensitivity: "base" })
        || left.identifier.localeCompare(right.identifier, "es", { sensitivity: "base" })
    )));
}

export function filterAdministrationUsers(users, query) {
    const normalizedQuery = text(query).toLocaleLowerCase("es");
    if (!normalizedQuery) return normalizeAdministrationUsers(users);
    return Object.freeze(normalizeAdministrationUsers(users).filter((user) => (
        `${user.displayName}\n${user.identifier}`.toLocaleLowerCase("es").includes(normalizedQuery)
    )));
}

export function normalizeMaximumLoginAttempts(value, fallback = 5) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(MAX_LOGIN_ATTEMPTS, Math.max(MIN_LOGIN_ATTEMPTS, parsed));
}

export function formatLastLogin(value, locale = "es-ES") {
    const raw = text(value);
    if (!raw) return "Nunca";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "No disponible";
    try {
        return new Intl.DateTimeFormat(locale, {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC"
        }).format(date);
    } catch {
        return date.toISOString();
    }
}

/**
 * Required hook contract for `UserAdministrationPanel`.
 *
 * ```js
 * {
 *   users, settings: { maxLoginAttempts }, loading, busy, error,
 *   searchUsers(query), updateUser(userId, patch), setUserNote(userId, note),
 *   deleteUser(userId), setPasswordChangeRequired(userId, required),
 *   resetUserPassword(userId, newPassword),
 *   clearPasswordResetRequest(userId), updateSecuritySettings(patch)
 * }
 * ```
 *
 * The hook must enforce authorization and validate every mutation. Rendering
 * this panel is not an authorization decision; `isAdministratorSession()` is
 * only a defensive UI gate.
 *
 * @public Stable contract between the identity hook and administration workspace.
 */
export const USER_ADMINISTRATION_HOOK_CONTRACT = Object.freeze([
    "users",
    "settings",
    "loading",
    "busy",
    "error",
    "searchUsers",
    "updateUser",
    "setUserNote",
    "deleteUser",
    "setPasswordChangeRequired",
    "resetUserPassword",
    "clearPasswordResetRequest",
    "updateSecuritySettings"
]);
