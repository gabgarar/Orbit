import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ADMIN_BOOTSTRAP_IDENTIFIER } from "../../../../front/js/features/identity/index.js";
import { LOCAL_IDENTITY_MIN_PASSWORD_LENGTH } from "./identityPresentation.js";
import "./IdentityAccessPanel.css";

const PROVIDERS = Object.freeze(["google", "microsoft"]);
const IDENTIFIER_LOOKUP_DELAY_MS = 350;

function isLookupReadyIdentifier(value) {
    const identifier = String(value || "").trim();
    return identifier.length >= 3
        && identifier.length <= 320
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(identifier);
}

function isReservedAdministratorIdentifier(value) {
    return String(value || "").trim().normalize("NFKC").toLowerCase() === ADMIN_BOOTSTRAP_IDENTIFIER;
}

function MailIcon() {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="2.3" stroke="currentColor" strokeWidth="1.6" /><path d="m4.7 7 6.05 4.55a2.1 2.1 0 0 0 2.5 0L19.3 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function LockIcon() {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><rect x="5" y="10.1" width="14" height="10" rx="2.1" stroke="currentColor" strokeWidth="1.6" /><path d="M8.2 10.1V7.6a3.8 3.8 0 1 1 7.6 0v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function EyeIcon({ open = false }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">{open ? <><path d="M2.7 12s3.25-5.3 9.3-5.3 9.3 5.3 9.3 5.3-3.25 5.3-9.3 5.3S2.7 12 2.7 12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.6" /></> : <><path d="M3 3 21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M10 6.9A10.1 10.1 0 0 1 12 6.7c6.05 0 9.3 5.3 9.3 5.3a16.4 16.4 0 0 1-3.08 3.53M6.15 6.15A16.5 16.5 0 0 0 2.7 12s3.25 5.3 9.3 5.3c.9 0 1.73-.12 2.5-.33" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M9.7 9.7a3.25 3.25 0 0 0 4.6 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>}</svg>;
}

function ArrowIcon() {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M5 12h13M13 7l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ShieldIcon() {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M12 3.5 18.5 6v5.25c0 4.2-2.7 7.48-6.5 9.25-3.8-1.77-6.5-5.05-6.5-9.25V6L12 3.5Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" /><path d="m9.25 12 1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function GoogleMark() {
    return <svg aria-hidden="true" className="orbit-identity-access-panel__provider-mark" viewBox="0 0 24 24"><path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.2-.2-1.71H12v3.36h5.52c-.11.84-.73 2.1-2.1 2.95l-.02.11 3.06 2.32.21.02c1.92-1.72 2.93-4.26 2.93-7.05Z" /><path fill="#34a853" d="M12 22c2.7 0 4.96-.87 6.61-2.36l-3.15-2.45c-.84.57-1.96.97-3.46.97a5.99 5.99 0 0 1-5.66-4.07l-.1.01-3.18 2.41-.04.1A9.98 9.98 0 0 0 12 22Z" /><path fill="#fbbc05" d="M6.34 14.09A6.08 6.08 0 0 1 6.02 12c0-.73.13-1.44.31-2.09v-.13L3.12 7.34l-.1.05A9.7 9.7 0 0 0 2 12c0 1.67.4 3.25 1.02 4.61l3.32-2.52Z" /><path fill="#ea4335" d="M12 5.84c1.9 0 3.18.81 3.91 1.49l2.85-2.71C16.94 2.95 14.7 2 12 2a9.98 9.98 0 0 0-8.98 5.39l3.32 2.53A5.99 5.99 0 0 1 12 5.84Z" /></svg>;
}

function MicrosoftMark() {
    return <svg aria-hidden="true" className="orbit-identity-access-panel__provider-mark" viewBox="0 0 24 24"><path fill="#f35325" d="M2 2h9.52v9.52H2z" /><path fill="#81bc06" d="M12.48 2H22v9.52h-9.52z" /><path fill="#05a6f0" d="M2 12.48h9.52V22H2z" /><path fill="#ffba08" d="M12.48 12.48H22V22h-9.52z" /></svg>;
}

function ProviderButton({ provider, available, busy, onRequest }) {
    const google = provider === "google";
    const label = google ? "Continuar con Google" : "Continuar con Microsoft";
    return <button
        className="orbit-identity-access-panel__provider-button"
        type="button"
        disabled={busy || !available}
        title={available ? "" : "Este acceso no está disponible en este dispositivo."}
        onClick={() => onRequest(provider)}
    >
        {google ? <GoogleMark /> : <MicrosoftMark />}
        <span>{label}</span>
    </button>;
}

function Field({ label, children }) {
    return <label className="orbit-identity-access-panel__field">
        <span>{label}</span>
        {children}
    </label>;
}

/**
 * Login surface for a local-only Orbit space.  The email and password share
 * the visual form, but the password is never enabled until the selector-only
 * probe has safely resolved the typed identifier.
 */
export default function IdentityAccessPanel({ identity, className = "" }) {
    const [screen, setScreen] = useState("sign-in");
    const [fields, setFields] = useState({ displayName: "", identifier: "", password: "" });
    const [lookupStatus, setLookupStatus] = useState("idle");
    const [passwordResetOpen, setPasswordResetOpen] = useState(false);
    const [passwordResetIdentifier, setPasswordResetIdentifier] = useState("");
    const [passwordAllowed, setPasswordAllowed] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [providerSetup, setProviderSetup] = useState("");
    const [providerFields, setProviderFields] = useState({ displayName: "", identifier: "", password: "" });
    const [passwordChangeFields, setPasswordChangeFields] = useState({ currentPassword: "", newPassword: "", confirmation: "" });
    const [passwordChangeError, setPasswordChangeError] = useState("");
    const identityRef = useRef(identity);
    const identifierRef = useRef("");
    const identifierRevisionRef = useRef(0);
    const identifierLookupTimerRef = useRef(null);
    const headingId = useId();
    const passwordResetHeadingId = useId();
    const passwordResetDescriptionId = useId();
    const previouslyAuthenticated = useRef(false);
    const isBusy = identity?.busy === true;
    const identityState = identity?.session?.identityState || identity?.identityState || "unauthenticated";
    const isAuthenticated = identityState !== "unauthenticated";
    const hasIdentity = Boolean(identity);
    const providerAvailable = (provider) => identity?.providers?.[provider]?.available === true;
    identityRef.current = identity;

    const checkIdentifier = useCallback(async (candidateIdentifier, expectedRevision = identifierRevisionRef.current) => {
        const currentIdentity = identityRef.current;
        const identifier = String(candidateIdentifier || "");
        const scheduledTimer = identifierLookupTimerRef.current;
        if (scheduledTimer !== null) {
            globalThis.clearTimeout(scheduledTimer);
            identifierLookupTimerRef.current = null;
        }
        if (!isLookupReadyIdentifier(identifier)) return null;
        setLookupStatus("checking");
        setPasswordAllowed(false);
        currentIdentity?.clearFeedback?.();
        const result = await currentIdentity?.checkLocalAccountAvailability?.({ identifier });
        // Do not apply a delayed selector result to a newer email value.
        if (identifierRevisionRef.current !== expectedRevision || identifierRef.current !== identifier) return result;
        if (!result) {
            setLookupStatus("unavailable");
            setPasswordAllowed(false);
            return null;
        }
        if (result.exists === true) {
            setLookupStatus("found");
            setPasswordAllowed(true);
            return result;
        }
        if (result.exists === null) {
            // It remains safe to try the password: the encrypted vault will
            // only unlock after credential verification, without confirming
            // whether a local account exists.
            setLookupStatus("indeterminate");
            setPasswordAllowed(true);
            return result;
        }
        setLookupStatus("missing");
        setPasswordAllowed(false);
        return result;
    }, []);

    useEffect(() => {
        if (isAuthenticated) setFields((current) => ({ ...current, password: "" }));
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated && previouslyAuthenticated.current) {
            setScreen("sign-in");
            setLookupStatus("idle");
            setPasswordAllowed(false);
            setProviderSetup("");
            setFields((current) => ({ ...current, password: "" }));
        }
        previouslyAuthenticated.current = isAuthenticated;
    }, [isAuthenticated]);

    useEffect(() => {
        if (identity?.session?.passwordChangeRequired === true) return;
        setPasswordChangeFields({ currentPassword: "", newPassword: "", confirmation: "" });
        setPasswordChangeError("");
    }, [identity?.session?.passwordChangeRequired]);

    useEffect(() => {
        if (!hasIdentity
            || screen !== "sign-in"
            || isAuthenticated
            || isBusy
            || lookupStatus !== "idle"
            || !isLookupReadyIdentifier(fields.identifier)) return undefined;
        const identifier = fields.identifier;
        const revision = identifierRevisionRef.current;
        const timer = globalThis.setTimeout(() => {
            if (identifierLookupTimerRef.current === timer) identifierLookupTimerRef.current = null;
            void checkIdentifier(identifier, revision);
        }, IDENTIFIER_LOOKUP_DELAY_MS);
        identifierLookupTimerRef.current = timer;
        return () => {
            globalThis.clearTimeout(timer);
            if (identifierLookupTimerRef.current === timer) identifierLookupTimerRef.current = null;
        };
    }, [checkIdentifier, fields.identifier, hasIdentity, isAuthenticated, isBusy, lookupStatus, screen]);

    if (!identity) {
        return <section className={"orbit-identity-access-panel " + className} role="alert">
            No se ha configurado el acceso de identidad local.
        </section>;
    }

    const updateIdentifier = (identifier) => {
        const scheduledTimer = identifierLookupTimerRef.current;
        if (scheduledTimer !== null) {
            globalThis.clearTimeout(scheduledTimer);
            identifierLookupTimerRef.current = null;
        }
        identifierRef.current = identifier;
        identifierRevisionRef.current += 1;
        setFields((current) => ({ ...current, identifier, password: "" }));
        setLookupStatus("idle");
        setPasswordAllowed(false);
        identity.clearFeedback?.();
    };

    const checkIdentifierOnBlur = () => {
        if (isBusy || lookupStatus !== "idle" || !isLookupReadyIdentifier(fields.identifier)) return;
        void checkIdentifier(fields.identifier, identifierRevisionRef.current);
    };

    const submitSignIn = async (event) => {
        event.preventDefault();
        if (!passwordAllowed) {
            await checkIdentifier(fields.identifier, identifierRevisionRef.current);
            return;
        }
        const result = await identity.loginLocalAccount({
            identifier: fields.identifier,
            password: fields.password
        });
        if (result) setFields((current) => ({ ...current, password: "" }));
    };

    const openRegistration = () => {
        identity.clearFeedback?.();
        setScreen("register");
        setLookupStatus("idle");
        setPasswordResetOpen(false);
        setPasswordResetIdentifier("");
        setPasswordAllowed(false);
        setFields((current) => ({ ...current, password: "" }));
    };

    const returnToSignIn = () => {
        identity.clearFeedback?.();
        setScreen("sign-in");
        setLookupStatus("idle");
        setPasswordResetOpen(false);
        setPasswordResetIdentifier("");
        setPasswordAllowed(false);
        setFields((current) => ({ ...current, password: "" }));
    };

    const register = async (event) => {
        event.preventDefault();
        const result = isReservedAdministratorIdentifier(fields.identifier)
            ? await identity.bootstrapAdminAccount?.(fields)
            : await identity.createLocalAccount(fields);
        if (result) setFields((current) => ({ ...current, password: "" }));
    };

    const openPasswordReset = () => {
        identity.clearFeedback?.();
        setLookupStatus("idle");
        // Recovery always starts with a separate, explicit identifier. This
        // prevents a stale sign-in value from creating an accidental request.
        setPasswordResetIdentifier("");
        setPasswordResetOpen(true);
    };

    const closePasswordReset = () => {
        if (isBusy) return;
        setPasswordResetOpen(false);
        setPasswordResetIdentifier("");
    };

    const requestPasswordReset = async (event) => {
        event.preventDefault();
        identity.clearFeedback?.();
        const result = await identity.requestLocalPasswordReset?.({ identifier: passwordResetIdentifier });
        if (result) {
            setPasswordResetOpen(false);
            setPasswordResetIdentifier("");
            setLookupStatus("forgot");
        }
    };

    const submitRequiredPasswordChange = async (event) => {
        event.preventDefault();
        if (passwordChangeFields.newPassword !== passwordChangeFields.confirmation) {
            setPasswordChangeError("Las contraseñas nuevas no coinciden.");
            return;
        }
        setPasswordChangeError("");
        identity.clearFeedback?.();
        const result = await identity.changeLocalPassword?.({
            currentPassword: passwordChangeFields.currentPassword,
            newPassword: passwordChangeFields.newPassword
        });
        if (result) setPasswordChangeFields({ currentPassword: "", newPassword: "", confirmation: "" });
    };

    const beginProviderSetup = (provider) => {
        if (!providerAvailable(provider)) return;
        identity.clearFeedback?.();
        setProviderSetup(provider);
        setProviderFields((current) => ({
            ...current,
            displayName: current.displayName || fields.displayName,
            identifier: current.identifier || fields.identifier,
            password: ""
        }));
    };

    const providerLabel = providerSetup === "google" ? "Google" : "Microsoft";
    const lookupFeedback = lookupStatus === "missing"
        ? "No se ha encontrado una cuenta local con este correo en este dispositivo. Revisa lo que has escrito o regístrate."
        : lookupStatus === "indeterminate"
            ? "No se ha podido confirmar la cuenta en este dispositivo. Puedes probar tu contraseña de forma segura; Orbit no mostrará información de la cuenta."
            : lookupStatus === "forgot"
                ? "Se ha solicitado al administrador un cambio de contraseña."
                : "";
    const feedback = identity.error || identity.notice;

    if (isAuthenticated && identity.session?.passwordChangeRequired === true) {
        return <section className={"orbit-identity-access-panel orbit-identity-access-panel--password-change " + className} aria-labelledby={headingId} data-testid="identity-password-change-panel">
            <Brand />
            <h1 id={headingId}>Actualiza tu contraseña</h1>
            <p className="orbit-identity-access-panel__description">El administrador ha solicitado un cambio antes de poder abrir el espacio local.</p>
            <form className="orbit-identity-access-panel__form" onSubmit={submitRequiredPasswordChange}>
                <Field label="Contraseña actual">
                    <span className="orbit-identity-access-panel__input-shell">
                        <LockIcon />
                        <input className="orbit-identity-access-panel__input" type="password" minLength={LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} autoComplete="current-password" required value={passwordChangeFields.currentPassword} disabled={isBusy} placeholder="Password" onChange={(event) => setPasswordChangeFields((current) => ({ ...current, currentPassword: event.target.value }))} />
                    </span>
                </Field>
                <Field label="Nueva contraseña">
                    <span className="orbit-identity-access-panel__input-shell">
                        <LockIcon />
                        <input className="orbit-identity-access-panel__input" type="password" minLength={LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} autoComplete="new-password" required value={passwordChangeFields.newPassword} disabled={isBusy} placeholder="Password" onChange={(event) => setPasswordChangeFields((current) => ({ ...current, newPassword: event.target.value }))} />
                    </span>
                </Field>
                <Field label="Repite la nueva contraseña">
                    <span className="orbit-identity-access-panel__input-shell">
                        <LockIcon />
                        <input className="orbit-identity-access-panel__input" type="password" minLength={LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} autoComplete="new-password" required value={passwordChangeFields.confirmation} disabled={isBusy} placeholder="Password" onChange={(event) => setPasswordChangeFields((current) => ({ ...current, confirmation: event.target.value }))} />
                    </span>
                </Field>
                {(passwordChangeError || feedback) && <p className="orbit-identity-access-panel__feedback is-error" role="alert">{passwordChangeError || feedback}</p>}
                <button className="orbit-identity-access-panel__primary-action" type="submit" disabled={isBusy}><span>{isBusy ? "Actualizando…" : "Actualizar contraseña"}</span><ArrowIcon /></button>
            </form>
            <button className="orbit-identity-access-panel__text-action orbit-identity-access-panel__password-change-signout" type="button" disabled={isBusy} onClick={identity.signOut}>Cerrar sesión</button>
            <PrivacyLine />
        </section>;
    }

    if (isAuthenticated) {
        const externalProvider = identityState === "google_user"
            ? "Google"
            : identityState === "microsoft_user"
                ? "Microsoft"
                : "local";
        return <section className={"orbit-identity-access-panel orbit-identity-access-panel--session " + className} aria-labelledby={headingId} data-testid="identity-session-panel">
            <Brand />
            <h2 id={headingId}>Sesión abierta</h2>
            <p className="orbit-identity-access-panel__description">{identity.session?.displayName || identity.session?.identifier || "Cuenta local"} está usando Orbit en este dispositivo.</p>
            {identity.externalSignInPending && <div className="orbit-identity-access-panel__feedback is-notice" role="status">
                <strong>Continuando con {identity.externalSignInPending === "google" ? "Google" : "Microsoft"}.</strong> Completa el acceso en la ventana que se ha abierto para continuar.
                <button className="orbit-identity-access-panel__text-action" type="button" onClick={identity.cancelExternalSignIn}>Continuar solo con cuenta local</button>
            </div>}
            {identity.notice && <p className="orbit-identity-access-panel__feedback is-notice" role="status">{identity.notice}</p>}
            {externalProvider !== "local" && <button className="orbit-identity-access-panel__outline-action" type="button" disabled={isBusy} onClick={identity.unlinkExternalIdentity}>Desvincular {externalProvider}</button>}
            <button className="orbit-identity-access-panel__primary-action" type="button" onClick={identity.signOut}>Cerrar sesión</button>
            <PrivacyLine />
        </section>;
    }

    return <section className={"orbit-identity-access-panel " + className} aria-labelledby={headingId} data-testid="identity-access-panel">
        <Brand />
        {screen === "sign-in" && <>
            <h1 id={headingId}>Bienvenido de nuevo</h1>
            <p className="orbit-identity-access-panel__description">Inicia sesión para acceder a tu espacio local de Orbit.</p>
            <form className="orbit-identity-access-panel__form" onSubmit={submitSignIn}>
                <Field label="Correo electrónico">
                    <span className="orbit-identity-access-panel__input-shell">
                        <MailIcon />
                        <input className="orbit-identity-access-panel__input" type="email" inputMode="email" minLength="3" maxLength="320" autoComplete="username" spellCheck="false" required value={fields.identifier} disabled={isBusy} placeholder="tu@correo.com" onChange={(event) => updateIdentifier(event.target.value)} onBlur={checkIdentifierOnBlur} />
                    </span>
                </Field>
                <Field label="Contraseña">
                    <span className="orbit-identity-access-panel__input-shell">
                        <LockIcon />
                        <input className="orbit-identity-access-panel__input" type={showPassword ? "text" : "password"} minLength={LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} autoComplete="current-password" required={passwordAllowed} value={fields.password} disabled={isBusy || !passwordAllowed} placeholder="Password" onChange={(event) => setFields((current) => ({ ...current, password: event.target.value }))} />
                        <button className="orbit-identity-access-panel__reveal-password" type="button" disabled={isBusy || !passwordAllowed} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword((visible) => !visible)}><EyeIcon open={showPassword} /></button>
                    </span>
                </Field>
                {lookupFeedback && <p className={"orbit-identity-access-panel__lookup-feedback is-" + lookupStatus} role="status">{lookupFeedback}</p>}
                <button className="orbit-identity-access-panel__forgot-password" type="button" disabled={isBusy} onClick={openPasswordReset}>¿Olvidaste tu contraseña?</button>
                <button className="orbit-identity-access-panel__primary-action" type="submit" disabled={isBusy}>
                    <span>{isBusy ? "Comprobando…" : passwordAllowed ? "Iniciar sesión" : "Continuar"}</span>
                    <ArrowIcon />
                </button>
            </form>
            <div className="orbit-identity-access-panel__separator"><span>o continúa con</span></div>
            <div className="orbit-identity-access-panel__providers">
                {PROVIDERS.map((provider) => <ProviderButton key={provider} provider={provider} available={providerAvailable(provider)} busy={isBusy} onRequest={beginProviderSetup} />)}
            </div>
            <div className="orbit-identity-access-panel__register-prompt">
                <span>¿No tienes cuenta?</span>
                <button type="button" disabled={isBusy} onClick={openRegistration}>Regístrate gratis</button>
            </div>
            {passwordResetOpen && <div className="orbit-identity-access-panel__recovery-backdrop">
                <section className="orbit-identity-access-panel__recovery-dialog" role="dialog" aria-modal="true" aria-labelledby={passwordResetHeadingId} aria-describedby={passwordResetDescriptionId}>
                    <h2 id={passwordResetHeadingId}>Solicita un cambio de contraseña</h2>
                    <p id={passwordResetDescriptionId}>Introduce el correo o usuario de la cuenta. Por seguridad, Orbit mostrará la misma confirmación aunque no exista una cuenta asociada.</p>
                    <form className="orbit-identity-access-panel__recovery-form" onSubmit={requestPasswordReset}>
                        <Field label="Correo electrónico o usuario">
                            <span className="orbit-identity-access-panel__input-shell">
                                <MailIcon />
                                <input className="orbit-identity-access-panel__input" type="text" inputMode="email" minLength="3" maxLength="320" autoComplete="username" spellCheck="false" required autoFocus value={passwordResetIdentifier} disabled={isBusy} placeholder="tu@correo.com" onChange={(event) => setPasswordResetIdentifier(event.target.value)} />
                            </span>
                        </Field>
                        <div className="orbit-identity-access-panel__recovery-actions">
                            <button className="orbit-identity-access-panel__outline-action" type="button" disabled={isBusy} onClick={closePasswordReset}>Cancelar</button>
                            <button className="orbit-identity-access-panel__primary-action" type="submit" disabled={isBusy}><span>{isBusy ? "Enviando…" : "Solicitar cambio"}</span><ArrowIcon /></button>
                        </div>
                    </form>
                </section>
            </div>}
        </>}

        {screen === "register" && <>
            <h1 id={headingId}>{isReservedAdministratorIdentifier(fields.identifier) ? "Configura la administración" : "Crea tu espacio Orbit"}</h1>
            <p className="orbit-identity-access-panel__description">{isReservedAdministratorIdentifier(fields.identifier) ? "Crearás la primera cuenta administradora local de esta instalación." : "Tus proyectos y planificación permanecen cifrados en este dispositivo."}</p>
            <form className="orbit-identity-access-panel__form" onSubmit={register}>
                <Field label="Correo electrónico">
                    <span className="orbit-identity-access-panel__input-shell">
                        <MailIcon />
                        <input className="orbit-identity-access-panel__input" type="email" inputMode="email" minLength="3" maxLength="320" autoComplete="username" spellCheck="false" required value={fields.identifier} disabled={isBusy} placeholder="tu@correo.com" onChange={(event) => updateIdentifier(event.target.value)} />
                    </span>
                </Field>
                <Field label="Nombre mostrado (opcional)">
                    <span className="orbit-identity-access-panel__input-shell">
                        <input className="orbit-identity-access-panel__input orbit-identity-access-panel__input--plain" type="text" maxLength="120" autoComplete="name" value={fields.displayName} disabled={isBusy} placeholder="Tu nombre" onChange={(event) => setFields((current) => ({ ...current, displayName: event.target.value }))} />
                    </span>
                </Field>
                <Field label="Contraseña">
                    <span className="orbit-identity-access-panel__input-shell">
                        <LockIcon />
                        <input className="orbit-identity-access-panel__input" type={showPassword ? "text" : "password"} minLength={LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} autoComplete="new-password" required value={fields.password} disabled={isBusy} placeholder="Password" onChange={(event) => setFields((current) => ({ ...current, password: event.target.value }))} />
                        <button className="orbit-identity-access-panel__reveal-password" type="button" disabled={isBusy} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword((visible) => !visible)}><EyeIcon open={showPassword} /></button>
                    </span>
                </Field>
                <button className="orbit-identity-access-panel__primary-action" type="submit" disabled={isBusy}><span>{isBusy ? "Creando cuenta…" : isReservedAdministratorIdentifier(fields.identifier) ? "Crear administración" : "Crear cuenta"}</span><ArrowIcon /></button>
            </form>
            <div className="orbit-identity-access-panel__register-prompt">
                <span>¿Ya tienes una cuenta?</span>
                <button type="button" disabled={isBusy} onClick={returnToSignIn}>Iniciar sesión</button>
            </div>
        </>}

        {feedback && <p className={"orbit-identity-access-panel__feedback " + (identity.error ? "is-error" : "is-notice")} role={identity.error ? "alert" : "status"}>{feedback}</p>}

        {providerSetup && <form className="orbit-identity-access-panel__provider-vault" onSubmit={async (event) => {
            event.preventDefault();
            const result = await identity.requestProviderSignIn(providerSetup, providerFields);
            if (result) setProviderFields((current) => ({ ...current, password: "" }));
        }}>
            <h2>Continúa con {providerLabel}</h2>
            <p>Protege primero el espacio local que se vinculará con este acceso.</p>
            <Field label="Nombre mostrado (opcional)">
                <input className="orbit-identity-access-panel__input orbit-identity-access-panel__provider-input" type="text" maxLength="120" autoComplete="name" value={providerFields.displayName} disabled={isBusy} onChange={(event) => setProviderFields((current) => ({ ...current, displayName: event.target.value }))} />
            </Field>
            <Field label="Correo electrónico">
                <input className="orbit-identity-access-panel__input orbit-identity-access-panel__provider-input" type="email" minLength="3" maxLength="320" autoComplete="username" spellCheck="false" required value={providerFields.identifier} disabled={isBusy} placeholder="tu@correo.com" onChange={(event) => setProviderFields((current) => ({ ...current, identifier: event.target.value }))} />
            </Field>
            <Field label="Password">
                <input className="orbit-identity-access-panel__input orbit-identity-access-panel__provider-input" type="password" minLength={LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} autoComplete="new-password" required value={providerFields.password} disabled={isBusy} placeholder="Password" onChange={(event) => setProviderFields((current) => ({ ...current, password: event.target.value }))} />
            </Field>
            <div className="orbit-identity-access-panel__provider-actions">
                <button className="orbit-identity-access-panel__outline-action" type="button" disabled={isBusy} onClick={() => {
                    setProviderSetup("");
                    setProviderFields((current) => ({ ...current, password: "" }));
                }}>Cancelar</button>
                <button className="orbit-identity-access-panel__primary-action" type="submit" disabled={isBusy}><span>Continuar</span><ArrowIcon /></button>
            </div>
        </form>}

        <PrivacyLine />
    </section>;
}

function Brand() {
    return <header className="orbit-identity-access-panel__brand" aria-label="Orbit">
        <div className="orbit-identity-access-panel__brand-icon" aria-hidden="true" />
        <div className="orbit-identity-access-panel__brand-name">ORBIT</div>
        <div className="orbit-identity-access-panel__brand-tagline">TU ESPACIO. TUS ÓRBITAS.</div>
    </header>;
}

function PrivacyLine() {
    return <p className="orbit-identity-access-panel__privacy"><ShieldIcon /> <span>Tus datos se guardan cifrados en este dispositivo.</span></p>;
}
