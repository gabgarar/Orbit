import { useRef, useState } from "react";
import { downloadProjectDocument } from "../../../../front/js/runtime/projectFileIO.js";
import { PROJECT_CREATION_MODES } from "../../../../front/js/features/projects/userProjectLibrary.js";
import {
    canProjectUseExternalSync,
    projectHubDisplayName
} from "./projectHubModel.js";
import AccountMenu from "../../components/AccountMenu.jsx";
import "./UserProjectHub.css";

function HubIcon({ name }) {
    const common = { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" };
    switch (name) {
        case "bell": return <svg {...common}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>;
        case "plus": return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
        case "rocket": return <svg {...common}><path d="M14.5 4.5c2.8-1.7 4.7-1.6 4.7-1.6s.2 2-1.5 4.7l-5.5 7.7-3.5-3.5Z" /><path d="m10.5 11.8-4.2.8-2.4 2.4 4 .7M12.2 13.5l-.8 4.2-2.4 2.4-.7-4" /><circle cx="15.7" cy="7.2" r="1.35" /></svg>;
        case "upload": return <svg {...common}><path d="M12 15V4M8 8l4-4 4 4M5 15.5v3.2A1.8 1.8 0 0 0 6.8 20.5h10.4a1.8 1.8 0 0 0 1.8-1.8v-3.2" /></svg>;
        case "folder": return <svg {...common}><path d="M3.5 8.2A2.2 2.2 0 0 1 5.7 6h3.2l1.9 2.3H17a2.2 2.2 0 0 1 2.2 2.2v6.9a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2Z" /><path d="M3.8 11.1h16.4" /></svg>;
        case "edit": return <svg {...common}><path d="m5 18.8 3.3-.8L18.7 7.6a2.1 2.1 0 0 0-3-3L5.3 15Z" /><path d="m13.8 6.5 3.7 3.7M5 18.8l.6-3.8" /></svg>;
        case "copy": return <svg {...common}><rect x="8" y="8" width="10" height="10" rx="1.8" /><path d="M15.8 8V6.5A2.5 2.5 0 0 0 13.3 4H6.5A2.5 2.5 0 0 0 4 6.5v6.8a2.5 2.5 0 0 0 2.5 2.5H8" /></svg>;
        case "download": return <svg {...common}><path d="M12 4v11M8 11l4 4 4-4M5 18.5v.7A1.8 1.8 0 0 0 6.8 21h10.4a1.8 1.8 0 0 0 1.8-1.8v-.7" /></svg>;
        case "trash": return <svg {...common}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>;
        case "calendar": return <svg {...common}><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M8 3.5v4M16 3.5v4M4 10h16M8 14h.01M12 14h.01M16 14h.01" /></svg>;
        case "shield": return <svg {...common}><path d="M12 3.5 19 6v5.2c0 4.2-2.8 7.7-7 9.3-4.2-1.6-7-5.1-7-9.3V6Z" /><path d="m9.1 11.9 1.9 1.9 4.1-4.1" /></svg>;
        case "info": return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 10.8v5M12 8h.01" /></svg>;
        default: return null;
    }
}

function formatDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "Sin fecha";
    return new Intl.DateTimeFormat("es-ES", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC"
    }).format(date).replace(",", " ·") + " UTC";
}

function linkageLabel(project) {
    const provider = String(project?.linkage?.provider || "local").toLowerCase();
    if (provider === "google") return "Vinculado a Google";
    if (provider === "microsoft") return "Vinculado a Microsoft";
    return "Solo local";
}

function downloadName(name) {
    const safe = String(name || "orbit-project")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
        .trim()
        .slice(0, 80) || "orbit-project";
    return `${safe}.orbit.json`;
}

function displayFirstName(session) {
    const displayName = projectHubDisplayName(session);
    return displayName.split(/\s+/u)[0] || "operador";
}

function OrbitThumbnail() {
    return <div className="orbit-project-card__thumbnail" aria-hidden="true">
        <span className="orbit-project-card__orbit orbit-project-card__orbit--one" />
        <span className="orbit-project-card__orbit orbit-project-card__orbit--two" />
        <span className="orbit-project-card__planet" />
        <span className="orbit-project-card__satellite" />
    </div>;
}

function ActionButton({ icon, children, className = "", ...props }) {
    return <button className={`orbit-project-card__action ${className}`} type="button" {...props}>
        <HubIcon name={icon} />
        <span>{children}</span>
    </button>;
}

function ProjectCard({ project, session, busy, onOpen, onRename, onDuplicate, onDelete, onExport, onTogglePlannerSync }) {
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState(project.name);
    const syncAvailable = canProjectUseExternalSync(project, session);
    const syncEnabled = project?.modulePolicies?.planner?.syncPreference?.enabled === true;
    const commitRename = async () => {
        const next = name.trim();
        if (!next || next === project.name) {
            setName(project.name);
            setRenaming(false);
            return;
        }
        await onRename(project.id, next);
        setRenaming(false);
    };

    return <article className="orbit-project-card" data-project-id={project.id}>
        <OrbitThumbnail />
        <div className="orbit-project-card__body">
            <div className="orbit-project-card__heading">
                <div className="min-w-0">
                    {renaming ? <form className="orbit-project-card__rename" onSubmit={(event) => { event.preventDefault(); void commitRename(); }}>
                        <input maxLength="160" value={name} onChange={(event) => setName(event.target.value)} autoFocus aria-label="Nuevo nombre del proyecto" />
                        <button type="submit" disabled={busy}>Guardar</button>
                        <button type="button" disabled={busy} onClick={() => { setName(project.name); setRenaming(false); }}>Cancelar</button>
                    </form> : <h3 title={project.name}>{project.name}</h3>}
                    {!renaming && <p className="orbit-project-card__metadata"><span className={`orbit-project-card__badge ${project?.linkage?.linked ? "is-linked" : ""}`}>{project?.linkage?.linked ? "Vinculado" : "Local"}</span><span>{linkageLabel(project)} · Modificado {formatDate(project.updatedAt)}</span></p>}
                </div>
                {!renaming && <span className="orbit-project-card__scope" title={project?.linkage?.linked ? "Proyecto vinculado al proveedor de identidad" : "Proyecto almacenado únicamente en este dispositivo"}>{project?.linkage?.linked ? "Cuenta vinculada" : "Cifrado local"}</span>}
            </div>
            <div className="orbit-project-card__actions" aria-label={`Acciones para ${project.name}`}>
                <ActionButton icon="folder" className="is-primary" disabled={busy} onClick={() => onOpen(project.id)}>Abrir</ActionButton>
                <ActionButton icon="edit" disabled={busy} onClick={() => { setName(project.name); setRenaming(true); }}>Renombrar</ActionButton>
                <ActionButton icon="copy" disabled={busy} onClick={() => onDuplicate(project.id)}>Duplicar</ActionButton>
                <ActionButton icon="download" disabled={busy} onClick={() => onExport(project.id)}>Exportar</ActionButton>
                <ActionButton icon="trash" className="is-danger" disabled={busy} onClick={() => onDelete(project)}>Eliminar</ActionButton>
            </div>
            <div className="orbit-project-card__planner">
                <div className="orbit-project-card__planner-copy">
                    <span className="orbit-project-card__planner-icon"><HubIcon name="calendar" /></span>
                    <span><strong>Planificador</strong><small>{syncAvailable ? "Sincronización opcional del proveedor" : "Eventos del proyecto y exportación ICS local"}</small></span>
                </div>
                <label className="orbit-project-card__sync" title={syncAvailable ? "La sincronización siempre requiere autorización explícita." : "Una cuenta local no envía eventos a servicios externos."}>
                    <input type="checkbox" checked={syncEnabled} disabled={!syncAvailable || busy} onChange={(event) => onTogglePlannerSync(project.id, event.target.checked)} />
                    <span>Sincronizar</span>
                </label>
            </div>
        </div>
    </article>;
}

/** Authenticated landing page for the owner-scoped local project library. */
export default function UserProjectHub({
    session,
    library,
    startupReadiness,
    onOpenDocument,
    onExportProject,
    onSignOut,
    hasNotifications = false,
    notificationsOpen = false,
    onToggleNotifications
}) {
    const fileInput = useRef(null);
    const [projectName, setProjectName] = useState("Proyecto sin título");
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const startupReady = startupReadiness?.ready === true;

    const publishFeedback = (text, tone = "notice") => setFeedback({ text, tone });
    const run = async (work) => {
        setBusy(true);
        setFeedback(null);
        try {
            await work();
        } catch (error) {
            publishFeedback(error?.message || "No se pudo actualizar la biblioteca de proyectos.", "error");
        } finally {
            setBusy(false);
        }
    };

    const createAndOpen = () => run(async () => {
        if (!startupReady) throw new Error(startupReadiness?.message || "Orbit todavía está preparando los datos necesarios.");
        const record = await library.createProject({ name: projectName, activate: false });
        const opened = await onOpenDocument(record.document, record.metadata);
        if (opened === false) throw new Error("No se pudo abrir el proyecto recién creado.");
    });
    const open = (projectId) => run(async () => {
        if (!startupReady) throw new Error(startupReadiness?.message || "Orbit todavía está preparando los datos necesarios.");
        const record = await library.openProject(projectId, { activate: false });
        const opened = await onOpenDocument(record.document, record.metadata);
        if (opened === false) throw new Error("No se pudo abrir el proyecto local.");
    });
    const duplicate = (projectId) => run(async () => {
        await library.duplicateProject(projectId);
        publishFeedback("Se ha creado una copia local cifrada del proyecto.", "success");
    });
    const rename = (projectId, name) => run(async () => { await library.renameProject(projectId, name); });
    const remove = (project) => run(async () => {
        if (!window.confirm(`¿Eliminar permanentemente '${project.name}' de este dispositivo?`)) return;
        await library.deleteProject(project.id);
        publishFeedback("El proyecto local se ha eliminado.", "notice");
    });
    const exportProject = (projectId) => run(async () => {
        // The mounted renderer is authoritative for an active project. Ask it
        // to export its live document so a still-debounced local change cannot
        // be omitted from the user's portable file.
        if (typeof onExportProject === "function" && await onExportProject(projectId) === true) {
            publishFeedback("Se ha preparado la exportación del proyecto activo.", "success");
            return;
        }
        const record = await library.openProject(projectId, { activate: false });
        downloadProjectDocument(record.document, { filename: downloadName(record.metadata.name) });
        publishFeedback("Se ha preparado la exportación del proyecto.", "success");
    });
    const togglePlannerSync = (projectId, enabled) => run(async () => {
        await library.setPlannerSyncPreference(projectId, enabled);
        publishFeedback(enabled ? "La preferencia de sincronización se ha activado." : "La preferencia de sincronización se ha desactivado.", "notice");
    });
    const importFile = (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        void run(async () => {
            if (!startupReady) throw new Error(startupReadiness?.message || "Orbit todavía está preparando los datos necesarios.");
            const parsed = JSON.parse(await file.text());
            const record = await library.createProject({
                name: parsed?.name || file.name.replace(/\.(?:orbit\.)?json$/iu, ""),
                document: parsed,
                metadata: { creationMode: PROJECT_CREATION_MODES.IMPORTED },
                activate: false
            });
            const opened = await onOpenDocument(record.document, record.metadata);
            if (opened === false) throw new Error("El archivo no se pudo abrir como proyecto Orbit.");
        });
    };

    if (library.loading) {
        return <section className="orbit-project-hub orbit-project-hub--state" role="status">Abriendo la biblioteca local cifrada…</section>;
    }
    if (!library.ready) {
        return <section className="orbit-project-hub orbit-project-hub--state is-error" role="alert"><strong>No se pudo abrir la biblioteca de proyectos.</strong><span>{library.error || "Vuelve a iniciar sesión para desbloquear tus datos locales."}</span><button type="button" onClick={onSignOut}>Cerrar sesión</button></section>;
    }

    return <section className="orbit-project-hub" aria-label="Proyectos del usuario">
        <header className="orbit-project-hub__topbar">
            <div className="orbit-project-hub__brand" aria-label="Orbit">
                <img src="/assets/icon/favicon.svg" alt="" />
                <span>O R B I T</span>
            </div>
            <div className="orbit-project-hub__account">
                <button className={`orbit-project-hub__quiet-icon${hasNotifications ? " has-notifications" : ""}`} type="button" aria-label="Abrir alertas" aria-controls="orbitNotificationsPanel" aria-expanded={notificationsOpen} title="Alertas" onClick={onToggleNotifications}><HubIcon name="bell" /><span aria-hidden="true" /></button>
                <AccountMenu session={session} onSignOut={onSignOut} triggerId="projectHubUserBtn" triggerClassName="orbit-project-hub__avatar" popoverClassName="orbit-project-hub__account-popover" ariaLabel={`Abrir menú de ${projectHubDisplayName(session)}`} />
            </div>
        </header>
        <main className="orbit-project-hub__content">
            <header className="orbit-project-hub__welcome">
                <p>Hola, {displayFirstName(session)}</p>
                <h1>Tus proyectos</h1>
                <span aria-hidden="true" />
            </header>

            <section className="orbit-project-hub__local-space" aria-labelledby="project-local-space-title">
                <div className="orbit-project-hub__local-copy">
                    <p>ESPACIO LOCAL</p>
                    <h2 id="project-local-space-title">Proyectos de {projectHubDisplayName(session)}</h2>
                    <span><HubIcon name="shield" />Tus proyectos se almacenan cifrados en este dispositivo.</span>
                </div>
            </section>

            <section className="orbit-project-hub__create" aria-labelledby="project-create-title">
                <div className="orbit-project-hub__section-label">
                    <p>NUEVO PROYECTO</p>
                    <h2 id="project-create-title">Crea o importa un proyecto</h2>
                </div>
                <div className="orbit-project-hub__create-controls">
                    <label>Nombre del proyecto
                        <input maxLength="160" value={projectName} disabled={busy || !startupReady} placeholder="Ej. Misión LEO" onChange={(event) => setProjectName(event.target.value)} />
                    </label>
                    <button className="orbit-project-hub__button is-primary" type="button" disabled={busy || !startupReady} onClick={createAndOpen}><HubIcon name="plus" /><span>Crear proyecto</span></button>
                    <button className="orbit-project-hub__button" type="button" disabled={busy || !startupReady} onClick={() => fileInput.current?.click()}><HubIcon name="upload" /><span>Importar proyecto</span></button>
                    <input ref={fileInput} type="file" accept=".orbit,.orbit.json,.json,application/json" hidden onChange={importFile} />
                </div>
                {!startupReady && <p className="orbit-project-hub__startup-status" role="status"><HubIcon name="info" />{startupReadiness?.message || "Preparando recursos de Orbit…"}</p>}
            </section>

            {feedback && <p className={`orbit-project-hub__feedback is-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}><HubIcon name={feedback.tone === "error" ? "info" : "shield"} />{feedback.text}</p>}
            {library.error && <p className="orbit-project-hub__feedback is-error" role="alert"><HubIcon name="info" />{library.error}</p>}

            <section className="orbit-project-hub__library" aria-labelledby="project-library-title">
                <div className="orbit-project-hub__library-heading">
                    <div><p>PROYECTOS ANTERIORES</p><h2 id="project-library-title">Tu biblioteca</h2></div>
                    <span>{library.projects.length} {library.projects.length === 1 ? "proyecto" : "proyectos"}</span>
                </div>
                {library.projects.length ? <div className="orbit-project-hub__project-list">{library.projects.map((project) => <ProjectCard key={project.id} project={project} session={session} busy={busy} onOpen={open} onRename={rename} onDuplicate={duplicate} onDelete={remove} onExport={exportProject} onTogglePlannerSync={togglePlannerSync} />)}</div> : <div className="orbit-project-hub__empty"><span><HubIcon name="folder" /></span><strong>Aún no tienes proyectos en esta cuenta.</strong><p>Crea una operación nueva o importa un archivo Orbit para empezar.</p></div>}
            </section>
        </main>
    </section>;
}
