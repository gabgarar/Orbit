import { useRef, useState } from "react";
import { downloadProjectDocument } from "../../../../front/js/runtime/projectFileIO.js";
import { PROJECT_CREATION_MODES } from "../../../../front/js/features/projects/userProjectLibrary.js";
import {
    canProjectUseExternalSync,
    projectHubDisplayName
} from "./projectHubModel.js";

const surface = "rounded-2xl border border-[#4d7fb7a8] bg-[#07172bd9] shadow-[0_18px_52px_rgba(0,0,0,.4)]";
const button = "rounded-lg border border-[#3e6fa8] bg-[#102946] px-3 py-2 font-sans text-[13px] font-semibold text-[#e9f4ff] transition-colors hover:bg-[#173b65] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = `${button} border-[#287eff] bg-[linear-gradient(135deg,#287eff,#1747bb)] hover:bg-[#245fd2]`;

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

    return <article className={`${surface} grid gap-3 p-4 text-left`} data-project-id={project.id}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
                {renaming ? <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void commitRename(); }}>
                    <input className="min-w-0 flex-1 rounded-md border border-[#5794d5] bg-[#020a16] px-2 py-1.5 font-sans text-sm text-white outline-none" maxLength="160" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
                    <button className={button} type="submit" disabled={busy}>Guardar</button>
                </form> : <h3 className="m-0 truncate font-sans text-[16px] font-semibold text-white" title={project.name}>{project.name}</h3>}
                <p className="mt-1 mb-0 font-sans text-[11px] text-[#9fb6d4]">{linkageLabel(project)} · Modificado {formatDate(project.updatedAt)}</p>
            </div>
            <span className={`rounded-full border px-2 py-1 font-sans text-[10px] font-bold ${project?.linkage?.linked ? "border-[#a180e3] bg-[#3b276c80] text-[#d7c7ff]" : "border-[#4e9678] bg-[#163d3180] text-[#adf0ca]"}`}>{project?.linkage?.linked ? "Vinculado" : "Local"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
            <button className={primaryButton} type="button" disabled={busy} onClick={() => onOpen(project.id)}>Abrir</button>
            <button className={button} type="button" disabled={busy} onClick={() => { setName(project.name); setRenaming((value) => !value); }}>{renaming ? "Cancelar" : "Renombrar"}</button>
            <button className={button} type="button" disabled={busy} onClick={() => onDuplicate(project.id)}>Duplicar</button>
            <button className={button} type="button" disabled={busy} onClick={() => onExport(project.id)}>Exportar</button>
            <button className="rounded-lg border border-[#9d5964] bg-[#32151bcc] px-3 py-2 font-sans text-[13px] font-semibold text-[#ffd9db] transition-colors hover:bg-[#572029] disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={busy} onClick={() => onDelete(project)}>Eliminar</button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#254969] bg-[#061325a6] px-3 py-2">
            <div>
                <strong className="block font-sans text-[12px] text-[#dcecff]">Planificador</strong>
                <span className="font-sans text-[11px] text-[#99b2d0]">{syncAvailable ? "Sincronización opcional del proveedor" : "Eventos del proyecto y exportación ICS local"}</span>
            </div>
            <label className="flex items-center gap-2 font-sans text-[11px] text-[#cfe3fb]" title={syncAvailable ? "La sincronización siempre requiere autorización explícita." : "Una cuenta local no envía eventos a servicios externos."}>
                <input type="checkbox" checked={syncEnabled} disabled={!syncAvailable || busy} onChange={(event) => onTogglePlannerSync(project.id, event.target.checked)} />
                Sincronizar
            </label>
        </div>
    </article>;
}

/** Authenticated landing page for the owner-scoped local project library. */
export default function UserProjectHub({ session, library, startupReadiness, onOpenDocument, onExportProject, onSignOut }) {
    const fileInput = useRef(null);
    const [projectName, setProjectName] = useState("Proyecto sin título");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const startupReady = startupReadiness?.ready === true;

    const run = async (work) => {
        setBusy(true);
        setMessage("");
        try {
            await work();
        } catch (error) {
            setMessage(error?.message || "No se pudo actualizar la biblioteca de proyectos.");
        } finally {
            setBusy(false);
        }
    };

    const createAndOpen = (generated) => run(async () => {
        if (!startupReady) throw new Error(startupReadiness?.message || "Orbit todavía está preparando los datos necesarios.");
        const name = generated ? "Proyecto vacío" : projectName;
        const record = await library.createProject({ name, generated, activate: false });
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
        setMessage("Se ha creado una copia local cifrada del proyecto.");
    });
    const rename = (projectId, name) => run(async () => { await library.renameProject(projectId, name); });
    const remove = (project) => run(async () => {
        if (!window.confirm(`¿Eliminar permanentemente '${project.name}' de este dispositivo?`)) return;
        await library.deleteProject(project.id);
        setMessage("El proyecto local se ha eliminado.");
    });
    const exportProject = (projectId) => run(async () => {
        // The mounted renderer is authoritative for an active project.  Ask it
        // to export its live document so a still-debounced local change cannot
        // be omitted from the user's portable file.
        if (typeof onExportProject === "function" && await onExportProject(projectId) === true) {
            setMessage("Se ha preparado la exportación del proyecto activo.");
            return;
        }
        const record = await library.openProject(projectId, { activate: false });
        downloadProjectDocument(record.document, { filename: downloadName(record.metadata.name) });
        setMessage("Se ha preparado la exportación del proyecto.");
    });
    const togglePlannerSync = (projectId, enabled) => run(async () => {
        await library.setPlannerSyncPreference(projectId, enabled);
        setMessage(enabled ? "La preferencia de sincronización se ha activado." : "La preferencia de sincronización se ha desactivado.");
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
        return <section className={`${surface} p-7 text-center font-sans text-[#c4d8f2]`} role="status">Abriendo la biblioteca local cifrada…</section>;
    }
    if (!library.ready) {
        return <section className={`${surface} grid gap-3 p-7 text-center font-sans text-[#ffd4d8]`} role="alert"><strong>No se pudo abrir la biblioteca de proyectos.</strong><span>{library.error || "Vuelve a iniciar sesión para desbloquear tus datos locales."}</span><button className={`${button} mx-auto`} type="button" onClick={onSignOut}>Cerrar sesión</button></section>;
    }

    return <section className="grid w-[min(800px,100%)] gap-5 text-left" aria-label="Proyectos del usuario">
        <header className={`${surface} flex flex-wrap items-center justify-between gap-4 p-5`}>
            <div>
                <p className="m-0 font-sans text-[10px] font-extrabold tracking-[2.5px] text-[#69a9ff]">ORBIT · ESPACIO LOCAL</p>
                <h2 className="mt-1 mb-1 font-sans text-[25px] font-bold text-white">Proyectos de {projectHubDisplayName(session)}</h2>
                <p className="m-0 font-sans text-[12px] text-[#a9bfd9]">Tus proyectos se almacenan cifrados en este dispositivo.</p>
            </div>
            <button className={button} type="button" onClick={onSignOut}>Cerrar sesión</button>
        </header>
        <section className={`${surface} grid gap-3 p-5`}>
            <div className="flex flex-wrap items-end gap-3">
                <label className="grid min-w-[230px] flex-1 gap-1.5 font-sans text-[12px] font-semibold text-[#bed2ea]">Nombre del proyecto
                    <input className="h-10 rounded-lg border border-[#396791] bg-[#020a16] px-3 font-sans text-sm text-white outline-none focus:border-[#64aaff]" maxLength="160" value={projectName} disabled={busy || !startupReady} onChange={(event) => setProjectName(event.target.value)} />
                </label>
                <button className={primaryButton} type="button" disabled={busy || !startupReady} onClick={() => createAndOpen(false)}>Crear proyecto</button>
                <button className={button} type="button" disabled={busy || !startupReady} onClick={() => createAndOpen(true)}>Generar desde cero</button>
                <button className={button} type="button" disabled={busy || !startupReady} onClick={() => fileInput.current?.click()}>Importar .orbit</button>
                <input ref={fileInput} type="file" accept=".orbit,.orbit.json,.json,application/json" hidden onChange={importFile} />
            </div>
            {!startupReady && <p className="m-0 font-sans text-[12px] text-[#c9def4]" role="status">{startupReadiness?.message || "Preparando recursos de Orbit…"}</p>}
        </section>
        {message && <p className={`${surface} m-0 border-[#9f6974] bg-[#2d1820e6] p-3 font-sans text-[12px] text-[#ffe0e2]`} role="status">{message}</p>}
        {library.error && <p className={`${surface} m-0 border-[#a35963] bg-[#38151be6] p-3 font-sans text-[12px] text-[#ffdce0]`} role="alert">{library.error}</p>}
        <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3 px-1"><h3 className="m-0 font-sans text-[15px] font-semibold text-[#e7f2ff]">Proyectos anteriores</h3><span className="font-sans text-[12px] text-[#9fb6d4]">{library.projects.length}</span></div>
            {library.projects.length ? <div className="grid max-h-[min(48dvh,460px)] gap-3 overflow-y-auto pr-1 orbit-scrollbar">{library.projects.map((project) => <ProjectCard key={project.id} project={project} session={session} busy={busy} onOpen={open} onRename={rename} onDuplicate={duplicate} onDelete={remove} onExport={exportProject} onTogglePlannerSync={togglePlannerSync} />)}</div> : <div className={`${surface} p-7 text-center font-sans text-[13px] text-[#a9bfd9]`}>Todavía no tienes proyectos en esta cuenta. Crea uno nuevo o importa un archivo Orbit.</div>}
        </section>
    </section>;
}
