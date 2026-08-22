import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUserProjectLibrary } from "../../../front/js/features/projects/userProjectLibrary.js";
import {
    createBlankUserProjectDocument,
    projectLinkageForIdentity
} from "../features/projects/projectHubModel.js";
import { projectWorkspaceStateForMetadata } from "../../../front/js/features/projects/projectStates.js";

function ownerIdFor(session) {
    const value = session?.accountId ?? session?.userId ?? session?.id;
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function updateProjectList(projects, metadata) {
    const next = [...projects.filter((candidate) => candidate?.id !== metadata?.id), metadata];
    return next.sort((left, right) => String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || "")));
}

/**
 * Owns just the encrypted local project library.  It deliberately does not
 * know how to mount a project into Cesium; callers receive a decrypted
 * document only after an authenticated vault has opened it and pass it to the
 * renderer through the separate project-runtime bridge.
 */
export default function useUserProjectLibrary({ identityService, session } = {}) {
    const ownerId = ownerIdFor(session);
    const [library, setLibrary] = useState(null);
    const [projects, setProjects] = useState([]);
    const [activeProjectId, setActiveProjectId] = useState(null);
    const [loading, setLoading] = useState(Boolean(ownerId));
    const [error, setError] = useState("");
    const generation = useRef(0);

    useEffect(() => {
        let disposed = false;
        const nextGeneration = generation.current + 1;
        generation.current = nextGeneration;
        setLibrary(null);
        setProjects([]);
        setActiveProjectId(null);
        setError("");

        if (!identityService || !ownerId) {
            setLoading(false);
            return () => { disposed = true; };
        }
        setLoading(true);
        void (async () => {
            try {
                const vault = await identityService.getUnlockedVault();
                const nextLibrary = createUserProjectLibrary({
                    session: { accountId: ownerId, vault },
                    storage: globalThis.localStorage
                });
                const entries = await nextLibrary.listProjects();
                if (disposed || generation.current !== nextGeneration) return;
                setLibrary(nextLibrary);
                setProjects(entries);
            } catch (cause) {
                if (disposed || generation.current !== nextGeneration) return;
                setError(cause?.message || "No se pudo abrir la biblioteca local de proyectos.");
            } finally {
                if (!disposed && generation.current === nextGeneration) setLoading(false);
            }
        })();
        return () => { disposed = true; };
    }, [identityService, ownerId]);

    const execute = useCallback(async (operation) => {
        if (!library) throw new Error("La biblioteca de proyectos aún no está disponible.");
        setError("");
        try {
            return await operation(library);
        } catch (cause) {
            const message = cause?.message || "No se pudo actualizar el proyecto local.";
            setError(message);
            throw cause;
        }
    }, [library]);

    const createProject = useCallback(async ({
        name,
        generated = false,
        document: importedDocument = null,
        metadata: metadataInput = null,
        // The hub keeps the prior project active until the renderer confirms
        // that the replacement really opened.  This prevents a cancelled
        // replacement dialog from making autosave target the new record.
        activate = true
    } = {}) => {
        const document = importedDocument && typeof importedDocument === "object"
            ? importedDocument
            : createBlankUserProjectDocument(name);
        const record = await execute(async (current) => {
            const metadata = await current.createProject({
                name: name || document.name,
                document,
                linkage: projectLinkageForIdentity(session),
                syncPreference: false,
                // It remains an authored local hint for a future template
                // catalogue. The canonical document stays portable .orbit JSON.
                metadata: {
                    ...(metadataInput && typeof metadataInput === "object" ? metadataInput : {}),
                    creationMode: metadataInput?.creationMode || (generated ? "project_generated" : "project_new")
                }
            });
            return current.loadProject(metadata.id);
        });
        setProjects((current) => updateProjectList(current, record.metadata));
        if (activate) setActiveProjectId(record.metadata.id);
        return record;
    }, [execute, session]);

    const openProject = useCallback(async (projectId, { activate = true } = {}) => {
        const record = await execute((current) => current.loadProject(projectId));
        if (activate) setActiveProjectId(record.metadata.id);
        return record;
    }, [execute]);

    const saveProject = useCallback(async (projectId, document) => {
        const metadata = await execute((current) => current.saveProject(projectId, document));
        setProjects((entries) => updateProjectList(entries, metadata));
        return metadata;
    }, [execute]);

    const renameProject = useCallback(async (projectId, name) => {
        const metadata = await execute((current) => current.renameProject(projectId, name));
        setProjects((entries) => updateProjectList(entries, metadata));
        return metadata;
    }, [execute]);

    const duplicateProject = useCallback(async (projectId, options = {}) => {
        const metadata = await execute((current) => current.duplicateProject(projectId, options));
        setProjects((entries) => updateProjectList(entries, metadata));
        return metadata;
    }, [execute]);

    const deleteProject = useCallback(async (projectId) => {
        const metadata = await execute((current) => current.deleteProject(projectId));
        setProjects((entries) => entries.filter((entry) => entry.id !== metadata.id));
        setActiveProjectId((current) => current === metadata.id ? null : current);
        return metadata;
    }, [execute]);

    const setPlannerSyncPreference = useCallback(async (projectId, enabled) => {
        const metadata = await execute((current) => current.setPlannerSyncPreference(projectId, enabled));
        setProjects((entries) => updateProjectList(entries, metadata));
        return metadata;
    }, [execute]);

    const refresh = useCallback(async () => {
        const entries = await execute((current) => current.listProjects());
        setProjects(entries);
        return entries;
    }, [execute]);

    const activeProject = useMemo(() => projects.find((project) => project.id === activeProjectId) || null, [projects, activeProjectId]);
    const workspaceState = useMemo(() => projectWorkspaceStateForMetadata(activeProject), [activeProject]);
    return {
        ready: Boolean(library) && !loading,
        loading,
        error,
        projects,
        activeProjectId,
        activeProject,
        workspaceState,
        createProject,
        openProject,
        saveProject,
        renameProject,
        duplicateProject,
        deleteProject,
        setPlannerSyncPreference,
        refresh,
        setActiveProjectId
    };
}
