import { useEffect, useId, useRef, useState } from "react";
import "./AccountMenu.css";

function accountInitials(session) {
    const source = String(session?.displayName || session?.identifier || "ORBIT").trim();
    const pieces = source.split(/\s+/u).filter(Boolean);
    const initials = pieces.length > 1
        ? `${pieces[0][0] || ""}${pieces.at(-1)?.[0] || ""}`
        : source.slice(0, 2);
    return (initials || "OR").toUpperCase();
}

function accountProviderLabel(session) {
    const provider = String(session?.provider || session?.identityState || "local").toLowerCase();
    if (provider.includes("google")) return "Google";
    if (provider.includes("microsoft")) return "Microsoft";
    return "Cuenta local";
}

function AccountIcon({ name }) {
    const common = { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" };
    if (name === "info") return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 10.8v5M12 8h.01" /></svg>;
    if (name === "projects") return <svg {...common}><path d="M3.5 8.2A2.2 2.2 0 0 1 5.7 6h3.2l1.9 2.3H17a2.2 2.2 0 0 1 2.2 2.2v6.9a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2Z" /><path d="M3.8 11.1h16.4" /></svg>;
    return <svg {...common}><path d="M10 5H6.8A1.8 1.8 0 0 0 5 6.8v10.4A1.8 1.8 0 0 0 6.8 19H10M14 8l4 4-4 4M18 12H9" /></svg>;
}

/**
 * A small, local account menu shared by the project library and the active
 * scene toolbar. It only exposes facts already held in the authenticated
 * session and never reaches into the encrypted project vault.
 */
export default function AccountMenu({
    session,
    onSignOut,
    onOpenProjects,
    triggerId,
    triggerClassName = "",
    popoverClassName = "",
    ariaLabel = "Abrir menú de cuenta"
}) {
    const [open, setOpen] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const menuId = useId();
    const displayName = String(session?.displayName || session?.identifier || "Cuenta de Orbit").trim();
    const identifier = String(session?.identifier || "Sin correo asociado").trim();
    const provider = accountProviderLabel(session);

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    const closeThen = (action) => {
        setOpen(false);
        setShowDetails(false);
        action?.();
    };

    return <div className="orbit-account-menu" ref={rootRef}>
        <button
            id={triggerId}
            className={`orbit-account-menu__trigger ${triggerClassName}`}
            type="button"
            ref={triggerRef}
            aria-label={ariaLabel}
            aria-haspopup="menu"
            aria-controls={menuId}
            aria-expanded={open}
            onClick={() => {
                setOpen((value) => !value);
                setShowDetails(false);
            }}
        >{accountInitials(session)}</button>
        {open && <section id={menuId} className={`orbit-account-menu__popover ${popoverClassName}`} role="menu" aria-label="Cuenta de usuario">
            <header className="orbit-account-menu__summary">
                <span className="orbit-account-menu__summary-avatar" aria-hidden="true">{accountInitials(session)}</span>
                <span><strong>{displayName}</strong><small>{identifier}</small><em>{provider}</em></span>
            </header>
            <div className="orbit-account-menu__actions">
                <button className="orbit-account-menu__item" type="button" role="menuitem" onClick={() => setShowDetails((value) => !value)}><AccountIcon name="info" /><span>Información de usuario</span></button>
                {showDetails && <dl className="orbit-account-menu__details">
                    <div><dt>Cuenta</dt><dd>{provider}</dd></div>
                    <div><dt>Rol</dt><dd>{session?.role === "admin" ? "Administración" : "Usuario"}</dd></div>
                    <div><dt>Acceso</dt><dd>{session?.identityState || "local_user"}</dd></div>
                </dl>}
                {typeof onOpenProjects === "function" && <button className="orbit-account-menu__item" type="button" role="menuitem" onClick={() => closeThen(onOpenProjects)}><AccountIcon name="projects" /><span>Volver a proyectos</span></button>}
                <button className="orbit-account-menu__item is-danger" type="button" role="menuitem" onClick={() => closeThen(onSignOut)}><AccountIcon name="signout" /><span>Cerrar sesión</span></button>
            </div>
        </section>}
    </div>;
}
