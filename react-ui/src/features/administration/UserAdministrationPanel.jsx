import { useEffect, useMemo, useState } from "react";
import { SearchIcon, TrashIcon } from "../../components/icons.jsx";
import { LOCAL_IDENTITY_MIN_PASSWORD_LENGTH } from "../identity/identityPresentation.js";
import {
    filterAdministrationUsers,
    formatLastLogin,
    isAdministratorSession,
    MAX_LOGIN_ATTEMPTS,
    MIN_LOGIN_ATTEMPTS,
    normalizeAdministrationUsers,
    normalizeMaximumLoginAttempts,
    providerLabel,
    USER_PROVIDER
} from "./adminPresentation.js";
import "./UserAdministrationPanel.css";

function ShieldIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 19 6v5.4c0 4.43-2.84 7.98-7 9.4-4.16-1.42-7-4.97-7-9.4V6l7-2.8Z" /><path d="m8.8 12 2 2 4.4-4.4" /></svg>;
}

function UserIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5 20c.55-3.55 2.85-5.45 7-5.45S18.45 16.45 19 20" /></svg>;
}

function LockIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /></svg>;
}

function EyeIcon({ open = false }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true">{open ? <><path d="M2.7 12s3.25-5.3 9.3-5.3 9.3 5.3 9.3 5.3-3.25 5.3-9.3 5.3S2.7 12 2.7 12Z" /><circle cx="12" cy="12" r="2.2" /></> : <><path d="M3 3 21 21" /><path d="M10 6.9A10.1 10.1 0 0 1 12 6.7c6.05 0 9.3 5.3 9.3 5.3a16.4 16.4 0 0 1-3.08 3.53M6.15 6.15A16.5 16.5 0 0 0 2.7 12s3.25 5.3 9.3 5.3c.9 0 1.73-.12 2.5-.33" /><path d="M9.7 9.7a3.25 3.25 0 0 0 4.6 4.6" /></>}</svg>;
}

function WarningIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 9 16H3l9-16Z" /><path d="M12 9v4.2M12 16.5h.01" /></svg>;
}

function ArrowIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
}

function ProviderBadge({ provider }) {
    const label = providerLabel(provider);
    const symbol = provider === USER_PROVIDER.GOOGLE ? "G" : provider === USER_PROVIDER.MICROSOFT ? "M" : "L";
    return <span className={`orbit-admin-provider is-${provider}`} title={`Cuenta ${label}`}><b aria-hidden="true">{symbol}</b>{label}</span>;
}

function UserAvatar({ user, large = false }) {
    const source = String(user?.displayName || user?.identifier || "OR").trim();
    const initials = source.split(/\s+/u).filter(Boolean).slice(0, 2).map((piece) => piece[0]).join("").toUpperCase() || "OR";
    return <span className={`orbit-admin-avatar${large ? " is-large" : ""}`} aria-hidden="true">{initials}</span>;
}

function StatusBadge({ children, tone = "neutral" }) {
    return <span className={`orbit-admin-status is-${tone}`}>{children}</span>;
}

function ActionButton({ children, tone = "neutral", className = "", ...props }) {
    return <button className={`orbit-admin-action is-${tone} ${className}`} type="button" {...props}>{children}</button>;
}

function panelError(error) {
    const message = error instanceof Error ? error.message : String(error || "").trim();
    return message || "No se ha podido completar la operación de administración.";
}

function attemptLabel(value, { singular = "intento", plural = "intentos" } = {}) {
    const numeric = Number(value) || 0;
    return `${numeric} ${numeric === 1 ? singular : plural}`;
}

function failuresBeforeLastSuccessLabel(user) {
    if (!user?.lastLoginAt) return "Sin inicio correcto";
    return attemptLabel(user.failedLoginAttemptsAtLastSuccess, { singular: "fallo", plural: "fallos" });
}

/**
 * Separate workspace for users authorized by the administration hook.
 *
 * It intentionally returns nothing for any other session and owns no viewer,
 * project library or identity-vault code. Authorization and every mutation
 * remain enforced by the hook supplied in `administration`.
 */
export default function UserAdministrationPanel({ session, administration, onSignOut }) {
    const admin = administration || {};
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [noteDraft, setNoteDraft] = useState("");
    const [maxAttemptsDraft, setMaxAttemptsDraft] = useState("5");
    const [passwordDraft, setPasswordDraft] = useState("");
    const [passwordConfirmation, setPasswordConfirmation] = useState("");
    const [showPasswordDraft, setShowPasswordDraft] = useState(false);
    const [pendingAction, setPendingAction] = useState("");
    const [actionError, setActionError] = useState("");
    const [notice, setNotice] = useState("");
    const [deleteArmed, setDeleteArmed] = useState(false);

    const users = useMemo(() => normalizeAdministrationUsers(admin.users), [admin.users]);
    const visibleUsers = useMemo(() => filterAdministrationUsers(users, query), [query, users]);
    const selectedUser = visibleUsers.find((user) => user.id === selectedId) || null;
    const hookBusy = admin.busy === true || admin.loading === true;
    const busy = hookBusy || Boolean(pendingAction);
    const configuredMaximumAttempts = normalizeMaximumLoginAttempts(admin.settings?.maxLoginAttempts, 5);
    // External sessions use an external subject as `accountId`; account
    // mutations are always keyed by the local encrypted protector.
    const currentAdministratorId = String(session?.localAccountId || session?.accountId || session?.id || "").trim();

    useEffect(() => {
        if (selectedUser) return;
        setSelectedId(visibleUsers[0]?.id || "");
    }, [selectedUser, visibleUsers]);

    useEffect(() => {
        setNoteDraft(selectedUser?.note || "");
        // Never carry a password draft from one selected account to another.
        setPasswordDraft("");
        setPasswordConfirmation("");
        setShowPasswordDraft(false);
        setDeleteArmed(false);
    }, [selectedUser?.id, selectedUser?.note]);

    useEffect(() => {
        setMaxAttemptsDraft(String(configuredMaximumAttempts));
    }, [configuredMaximumAttempts]);

    if (!isAdministratorSession(session)) return null;

    const run = async (name, operation, successNotice) => {
        if (busy || typeof operation !== "function") return;
        setPendingAction(name);
        setActionError("");
        setNotice("");
        try {
            await operation();
            setNotice(successNotice);
        } catch (error) {
            setActionError(panelError(error));
        } finally {
            setPendingAction("");
        }
    };

    const saveNote = () => {
        if (!selectedUser) return;
        const operation = typeof admin.setUserNote === "function"
            ? () => admin.setUserNote(selectedUser.id, noteDraft)
            : typeof admin.updateUser === "function"
                ? () => admin.updateUser(selectedUser.id, { note: noteDraft })
                : null;
        void run("note", operation, "Nota de operador guardada.");
    };

    const updateBlocked = () => {
        if (!selectedUser || typeof admin.updateUser !== "function") return;
        const nextBlocked = !selectedUser.blocked;
        void run("blocked", () => admin.updateUser(selectedUser.id, { blocked: nextBlocked }), nextBlocked ? "Usuario bloqueado." : "Usuario desbloqueado.");
    };

    const updatePasswordChange = (required) => {
        if (!selectedUser || typeof admin.setPasswordChangeRequired !== "function") return;
        void run("password-change", () => admin.setPasswordChangeRequired(selectedUser.id, required), required ? "Se solicitará cambio de contraseña en el próximo acceso." : "Solicitud de cambio de contraseña cancelada.");
    };

    const resetUserPassword = () => {
        if (!selectedUser || typeof admin.resetUserPassword !== "function") return;
        if (passwordDraft.length < LOCAL_IDENTITY_MIN_PASSWORD_LENGTH) {
            setActionError(`La contraseña debe tener al menos ${LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} caracteres.`);
            return;
        }
        if (passwordDraft !== passwordConfirmation) {
            setActionError("Las contraseñas nuevas no coinciden.");
            return;
        }
        // Copy only into this short-lived closure. Clear both controlled
        // fields before the asynchronous administrative call starts.
        const newPassword = passwordDraft;
        setPasswordDraft("");
        setPasswordConfirmation("");
        setShowPasswordDraft(false);
        void run(
            "set-password",
            () => admin.resetUserPassword(selectedUser.id, newPassword),
            "Contraseña local actualizada. El usuario deberá iniciar sesión con la nueva contraseña."
        );
    };

    const clearPasswordRequest = () => {
        if (!selectedUser || typeof admin.clearPasswordResetRequest !== "function") return;
        void run("clear-password-request", () => admin.clearPasswordResetRequest(selectedUser.id), "Solicitud de cambio marcada como atendida.");
    };

    const deleteUser = () => {
        if (!selectedUser || typeof admin.deleteUser !== "function") return;
        void run("delete", () => admin.deleteUser(selectedUser.id), "Usuario eliminado.");
    };

    const submitSearch = (event) => {
        event.preventDefault();
        if (typeof admin.searchUsers !== "function") return;
        void run("search", () => admin.searchUsers(query), "Lista de usuarios actualizada.");
    };

    const resetSearch = () => {
        setQuery("");
        if (typeof admin.searchUsers === "function") void run("search", () => admin.searchUsers(""), "Lista de usuarios actualizada.");
    };

    const saveMaximumAttempts = () => {
        if (typeof admin.updateSecuritySettings !== "function") return;
        const numeric = Number(maxAttemptsDraft);
        if (!Number.isInteger(numeric) || numeric < MIN_LOGIN_ATTEMPTS || numeric > MAX_LOGIN_ATTEMPTS) {
            setActionError(`El máximo de intentos debe estar entre ${MIN_LOGIN_ATTEMPTS} y ${MAX_LOGIN_ATTEMPTS}.`);
            return;
        }
        void run("security-settings", () => admin.updateSecuritySettings({ maxLoginAttempts: numeric }), "Límite de intentos actualizado.");
    };

    const selectedIsCurrentAdministrator = Boolean(selectedUser && currentAdministratorId && selectedUser.id === currentAdministratorId);
    const canUpdateUser = typeof admin.updateUser === "function" && !selectedIsCurrentAdministrator;
    const canDeleteUser = typeof admin.deleteUser === "function" && !selectedIsCurrentAdministrator;
    const selectedUserHasLocalPassword = Boolean(selectedUser);
    const canSetUserPassword = selectedUserHasLocalPassword
        && typeof admin.resetUserPassword === "function"
        && !selectedIsCurrentAdministrator;

    return <main className="orbit-admin-workspace" data-testid="user-administration-panel" aria-labelledby="orbitAdminTitle">
        <header className="orbit-admin-workspace__topbar">
            <div className="orbit-admin-workspace__brand">
                <span className="orbit-admin-workspace__brand-icon"><ShieldIcon /></span>
                <span><small>ORBIT · CONTROL DE ACCESO</small><strong>Administración</strong></span>
            </div>
            <div className="orbit-admin-workspace__operator"><span>Sesión de administrador</span><b>{session.displayName || session.identifier || "Administrador"}</b></div>
            <ActionButton tone="outline" onClick={onSignOut}>Cerrar sesión</ActionButton>
        </header>

        <section className="orbit-admin-workspace__content">
            <aside className="orbit-admin-directory" aria-labelledby="orbitAdminDirectoryTitle">
                <header className="orbit-admin-directory__header">
                    <div><small>DIRECTORIO</small><h1 id="orbitAdminDirectoryTitle">Usuarios</h1></div>
                    <span>{visibleUsers.length} de {users.length}</span>
                </header>
                <form className="orbit-admin-directory__search" role="search" onSubmit={submitSearch}>
                    <SearchIcon />
                    <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar correo o nombre" aria-label="Buscar correo o nombre" />
                    {query && <button type="button" aria-label="Limpiar búsqueda" onClick={resetSearch}>×</button>}
                </form>
                {admin.error && <p className="orbit-admin-message is-error" role="alert">{panelError(admin.error)}</p>}
                {admin.loading && !users.length ? <p className="orbit-admin-directory__empty" role="status">Cargando usuarios autorizados…</p> : null}
                {!admin.loading && !visibleUsers.length ? <p className="orbit-admin-directory__empty">No hay usuarios que coincidan con la búsqueda.</p> : null}
                <div className="orbit-admin-directory__list" role="listbox" aria-label="Usuarios de Orbit">
                    {visibleUsers.map((user) => <button className={`orbit-admin-user-row${user.id === selectedUser?.id ? " is-selected" : ""}`} type="button" role="option" aria-selected={user.id === selectedUser?.id} key={user.id} onClick={() => setSelectedId(user.id)}>
                        <UserAvatar user={user} />
                        <span className="orbit-admin-user-row__main">
                            <strong>{user.displayName}</strong>
                            <span>{user.identifier || "Sin correo registrado"}</span>
                            <small><ProviderBadge provider={user.provider} /><span>Último acceso: {formatLastLogin(user.lastLoginAt)}</span></small>
                            <span className="orbit-admin-user-row__attempts" aria-label={`Intentos actuales: ${attemptLabel(user.failedLoginAttempts)}. Fallos antes del último inicio correcto: ${failuresBeforeLastSuccessLabel(user)}.`}>
                                <span><em>Actual</em><b>{attemptLabel(user.failedLoginAttempts)}</b></span>
                                <span><em>Antes del éxito</em><b>{failuresBeforeLastSuccessLabel(user)}</b></span>
                            </span>
                        </span>
                        <span className="orbit-admin-user-row__flags">{user.blocked && <StatusBadge tone="blocked">Bloqueado</StatusBadge>}{user.passwordChangeRequired && <StatusBadge tone="warning">Forzado</StatusBadge>}{user.passwordResetRequested && <StatusBadge tone="warning">Solicitud</StatusBadge>}<ArrowIcon /></span>
                    </button>)}
                </div>
            </aside>

            <section className="orbit-admin-detail" aria-labelledby="orbitAdminTitle">
                {selectedUser ? <>
                    <header className="orbit-admin-detail__header">
                        <UserAvatar user={selectedUser} large />
                        <div><small>USUARIO SELECCIONADO</small><h2 id="orbitAdminTitle">{selectedUser.displayName}</h2><p>{selectedUser.identifier || "Sin correo registrado"}</p></div>
                        <ProviderBadge provider={selectedUser.provider} />
                    </header>

                    <dl className="orbit-admin-detail__facts">
                        <div><dt>Correo / identidad</dt><dd>{selectedUser.identifier || "No disponible"}</dd></div>
                        <div><dt>Último inicio de sesión</dt><dd>{formatLastLogin(selectedUser.lastLoginAt)}</dd></div>
                        <div><dt>Tipo de cuenta</dt><dd>{providerLabel(selectedUser.provider)}</dd></div>
                        <div><dt>Estado</dt><dd>{selectedUser.blocked ? <StatusBadge tone="blocked">Bloqueado</StatusBadge> : <StatusBadge tone="healthy">Activo</StatusBadge>}</dd></div>
                        <div><dt>Intentos actuales</dt><dd>{attemptLabel(selectedUser.failedLoginAttempts)}</dd></div>
                        <div><dt>Fallos antes del último éxito</dt><dd>{failuresBeforeLastSuccessLabel(selectedUser)}</dd></div>
                    </dl>

                    {selectedUser.passwordResetRequested && <section className="orbit-admin-password-warning" role="status"><WarningIcon /><div><strong>Solicitud de cambio de contraseña</strong><span>El usuario ha solicitado asistencia para cambiar su contraseña local.</span></div>{typeof admin.clearPasswordResetRequest === "function" && <ActionButton tone="outline" disabled={busy} onClick={clearPasswordRequest}>Marcar atendida</ActionButton>}</section>}

                    <section className="orbit-admin-detail__section" aria-labelledby="orbitAdminAccessTitle">
                        <div className="orbit-admin-detail__section-heading"><div><small>ACCESO</small><h3 id="orbitAdminAccessTitle">Controles de cuenta</h3></div>{selectedIsCurrentAdministrator && <span className="orbit-admin-self-note">No puedes modificar tu propia cuenta desde aquí.</span>}</div>
                        <div className="orbit-admin-detail__actions">
                            <ActionButton tone={selectedUser.blocked ? "healthy" : "warning"} disabled={busy || !canUpdateUser} title={!canUpdateUser ? "La acción no está disponible para esta cuenta." : ""} onClick={updateBlocked}><LockIcon />{selectedUser.blocked ? "Desbloquear usuario" : "Bloquear usuario"}</ActionButton>
                            <ActionButton tone="outline" disabled={busy || !canUpdateUser || typeof admin.setPasswordChangeRequired !== "function"} title={!canUpdateUser ? "La acción no está disponible para esta cuenta." : ""} onClick={() => updatePasswordChange(!selectedUser.passwordChangeRequired)}>{selectedUser.passwordChangeRequired ? "Cancelar cambio obligatorio" : "Forzar cambio en próximo inicio"}</ActionButton>
                        </div>
                        {selectedUser.passwordChangeRequired && <p className="orbit-admin-force-note" role="status"><LockIcon />Cambio obligatorio activo: el servicio debe pedir una contraseña nueva en el próximo inicio de sesión.</p>}
                    </section>

                    <section className="orbit-admin-detail__section" aria-labelledby="orbitAdminPasswordTitle">
                        <div className="orbit-admin-detail__section-heading"><div><small>CONTRASEÑA LOCAL DE ORBIT</small><h3 id="orbitAdminPasswordTitle">Establecer una contraseña nueva</h3></div></div>
                        <form className="orbit-admin-password-form" onSubmit={(event) => { event.preventDefault(); resetUserPassword(); }}>
                            <p>Establece la contraseña local de Orbit para ayudar a esta cuenta. La contraseña no se almacena ni se vuelve a mostrar en el panel. Cuando la recuperación administrativa esté disponible, Orbit conserva la bóveda y sus proyectos; las cuentas heredadas pueden requerir primero el cambio en su próximo inicio.</p>
                            {selectedUser.provider !== USER_PROVIDER.LOCAL && <p className="orbit-admin-password-form__external">No modifica la contraseña de {providerLabel(selectedUser.provider)}; solo actualiza el protector local de Orbit.</p>}
                            <div className="orbit-admin-password-form__fields">
                                <label>Nueva contraseña
                                    <span className="orbit-admin-password-input">
                                        <LockIcon />
                                        <input type={showPasswordDraft ? "text" : "password"} minLength={LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} autoComplete="new-password" required value={passwordDraft} disabled={busy || !canSetUserPassword} placeholder="Password" onChange={(event) => setPasswordDraft(event.target.value)} />
                                        <button type="button" disabled={busy || !canSetUserPassword} aria-label={showPasswordDraft ? "Ocultar contraseña nueva" : "Mostrar contraseña nueva"} onClick={() => setShowPasswordDraft((visible) => !visible)}><EyeIcon open={showPasswordDraft} /></button>
                                    </span>
                                </label>
                                <label>Confirmar contraseña
                                    <span className="orbit-admin-password-input">
                                        <LockIcon />
                                        <input type={showPasswordDraft ? "text" : "password"} minLength={LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} autoComplete="new-password" required value={passwordConfirmation} disabled={busy || !canSetUserPassword} placeholder="Repite la contraseña" onChange={(event) => setPasswordConfirmation(event.target.value)} />
                                    </span>
                                </label>
                            </div>
                            <div className="orbit-admin-password-form__footer"><span>Mínimo {LOCAL_IDENTITY_MIN_PASSWORD_LENGTH} caracteres.</span><ActionButton tone="primary" type="submit" disabled={busy || !canSetUserPassword} title={!canSetUserPassword ? "La acción no está disponible para esta cuenta." : ""}>Actualizar contraseña</ActionButton></div>
                        </form>
                        {selectedIsCurrentAdministrator && <p className="orbit-admin-password-form__hint">Para cambiar tu propia contraseña, cierra esta sesión y utiliza el flujo de cambio de contraseña de Orbit.</p>}
                    </section>

                    <section className="orbit-admin-detail__section" aria-labelledby="orbitAdminNotesTitle">
                        <div className="orbit-admin-detail__section-heading"><div><small>NOTAS</small><h3 id="orbitAdminNotesTitle">Notas del operador</h3></div><span>Solo visibles para administradores</span></div>
                        <textarea value={noteDraft} maxLength="4000" disabled={busy} placeholder="Añade contexto operativo, un motivo de bloqueo o una observación de soporte…" aria-label="Notas del operador" onChange={(event) => setNoteDraft(event.target.value)} />
                        <div className="orbit-admin-note-actions"><span>{noteDraft.length}/4000</span><ActionButton tone="primary" disabled={busy || (typeof admin.setUserNote !== "function" && typeof admin.updateUser !== "function")} onClick={saveNote}>Guardar nota</ActionButton></div>
                    </section>

                    <section className="orbit-admin-detail__section orbit-admin-detail__section--danger" aria-labelledby="orbitAdminDeleteTitle">
                        <div className="orbit-admin-detail__section-heading"><div><small>ZONA RESTRINGIDA</small><h3 id="orbitAdminDeleteTitle">Eliminar usuario</h3></div></div>
                        {!deleteArmed ? <div className="orbit-admin-danger-row"><p>Elimina la cuenta y sus referencias de administración. Esta acción debe ser confirmada por el servicio.</p><ActionButton tone="danger" disabled={busy || !canDeleteUser} title={!canDeleteUser ? "No puedes eliminar esta cuenta desde aquí." : ""} onClick={() => setDeleteArmed(true)}><TrashIcon />Eliminar</ActionButton></div> : <div className="orbit-admin-delete-confirm" role="alert"><WarningIcon /><span>¿Confirmas la eliminación de <b>{selectedUser.displayName}</b>?</span><ActionButton tone="outline" disabled={busy} onClick={() => setDeleteArmed(false)}>Cancelar</ActionButton><ActionButton tone="danger" disabled={busy} onClick={deleteUser}>Confirmar eliminación</ActionButton></div>}
                    </section>
                </> : <div className="orbit-admin-detail__empty"><UserIcon /><strong>Selecciona un usuario</strong><span>Elige una cuenta del directorio para revisar sus controles y notas administrativas.</span></div>}
                {(actionError || notice) && <p className={`orbit-admin-message ${actionError ? "is-error" : "is-notice"}`} role={actionError ? "alert" : "status"}>{actionError || notice}</p>}
            </section>

            <aside className="orbit-admin-security" aria-labelledby="orbitAdminSecurityTitle">
                <header><span><LockIcon /></span><div><small>POLÍTICA DE ACCESO</small><h2 id="orbitAdminSecurityTitle">Protección local</h2></div></header>
                <p>Aplica al inicio de sesión local. El servicio debe validar y aplicar este límite antes de desbloquear cualquier bóveda.</p>
                <label>Máximo de intentos fallidos<input type="number" min={MIN_LOGIN_ATTEMPTS} max={MAX_LOGIN_ATTEMPTS} step="1" value={maxAttemptsDraft} disabled={busy} onChange={(event) => setMaxAttemptsDraft(event.target.value)} /></label>
                <span className="orbit-admin-security__hint">Entre {MIN_LOGIN_ATTEMPTS} y {MAX_LOGIN_ATTEMPTS} intentos. Actual: {configuredMaximumAttempts}.</span>
                <ActionButton tone="primary" disabled={busy || typeof admin.updateSecuritySettings !== "function"} onClick={saveMaximumAttempts}>Guardar política</ActionButton>
            </aside>
        </section>
    </main>;
}
