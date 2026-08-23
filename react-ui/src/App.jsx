import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CesiumGlobe from "./components/CesiumGlobe.jsx";
import TopToolbar from "./components/layout/TopToolbar.jsx";
import BuiltInTestPanel from "./components/overlays/BuiltInTestPanel.jsx";
import HelpPanel from "./components/overlays/HelpPanel.jsx";
import InitialBitWarningNotice from "./components/overlays/InitialBitWarningNotice.jsx";
import NotificationCenter from "./components/overlays/NotificationCenter.jsx";
import OperationsPanel from "./components/overlays/OperationsPanel.jsx";
import OrbitOverlays from "./components/overlays/OrbitOverlays.jsx";
import ProjectWelcome from "./components/overlays/ProjectWelcome.jsx";
import UserAdministrationPanel from "./features/administration/UserAdministrationPanel.jsx";
import IdentityAccessPanel from "./features/identity/IdentityAccessPanel.jsx";
import PlannerPanel from "./features/planner/PlannerPanel.jsx";
import UserProjectHub from "./features/projects/UserProjectHub.jsx";
import TimeControlBar from "./features/simulation/TimeControlBar.jsx";
import { ORBIT_PLANNER_CLOSE_EVENT, ORBIT_PLANNER_OPEN_EVENT } from "./features/planner/plannerUiModel.js";
import useInitialBitWarningNotice from "./hooks/useInitialBitWarningNotice.js";
import useOrbitIdentity from "./hooks/useOrbitIdentity.js";
import useOrbitNotifications from "./hooks/useOrbitNotifications.js";
import useOrbitOperations from "./hooks/useOrbitOperations.js";
import useProjectWelcome from "./hooks/useProjectWelcome.js";
import useStartupStatus from "./hooks/useStartupStatus.js";
import useStartupWelcomePresentation from "./hooks/useStartupWelcomePresentation.js";
import useSystemDiagnostics from "./hooks/useSystemDiagnostics.js";
import useUserProjectLibrary from "./hooks/useUserProjectLibrary.js";
import { ORBIT_RUNTIME_STATUS_EVENT, requestProjectCommand } from "./services/projectRuntime.js";
import { continuousBitStatus } from "../../front/js/features/diagnostics/bitPresentation.js";
import {
    completeOperation,
    OPERATION_SCOPES,
    startOperation
} from "../../front/js/features/operations/operationsContract.js";
import {
    getStartupProjectReadiness
} from "../../front/js/features/diagnostics/startupStatus.js";

function portableProjectFileName(name) {
    const normalized = String(name || "orbit-project")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
        .trim()
        .slice(0, 80) || "orbit-project";
    return `${normalized}.orbit.json`;
}

// `exportedAt` is deliberately a transport timestamp in every document. It
// must not turn a no-op checkpoint into an encrypted write every time the
// renderer serialises the same authored project.
function projectSnapshotSignature(document) {
    if (!document || typeof document !== "object") return "";
    try {
        const { exportedAt: _exportedAt, ...authoredDocument } = document;
        return JSON.stringify(authoredDocument);
    } catch {
        return "";
    }
}

let projectCommandSequence = 0;

function nextProjectCommandRequestId() {
    projectCommandSequence += 1;
    const random = globalThis.crypto?.randomUUID?.();
    return `project-open-${random || `${Date.now().toString(36)}-${projectCommandSequence.toString(36)}`}`;
}

function IdentityGate({ identity }) {
    return <section
        id="orbitIdentityGate"
        className="fixed inset-0 z-[12000] grid place-items-center overflow-y-auto bg-[#020811] p-4 text-center"
        aria-label="Acceso a Orbit"
    >
        <img className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-60" src="/assets/fonts/fondo.png" alt="" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(1,7,19,.22),rgba(2,9,24,.06)_48%,rgba(1,7,19,.22)),radial-gradient(circle_at_50%_28%,rgba(31,78,171,.25),transparent_44%)]" aria-hidden="true" />
        <div className="relative z-10">
            <IdentityAccessPanel identity={identity} />
        </div>
    </section>;
}

export default function App() {
    const hostWindow = typeof window === "undefined" ? null : window;
    const identity = useOrbitIdentity({
        oauth: hostWindow?.__orbitOAuthConfig,
        oauthCompanion: hostWindow?.__orbitOAuthCompanion
    });
    const authenticatedIdentity = identity.isAuthenticated && !identity.requiresExternalIdentityCompletion;
    const passwordChangeRequired = identity.session?.passwordChangeRequired === true;
    const administratorWorkspace = authenticatedIdentity
        && identity.session?.role === "admin"
        && !passwordChangeRequired;
    // The administrative surface is deliberately not an alternative project
    // hub: it never mounts the renderer or requests a project-vault handle.
    const regularWorkspace = authenticatedIdentity
        && identity.session?.role !== "admin"
        && !passwordChangeRequired;
    const userProjects = useUserProjectLibrary({
        identityService: identity.service,
        session: regularWorkspace ? identity.session : null
    });
    const [runtimeMounted, setRuntimeMounted] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [operationsOpen, setOperationsOpen] = useState(false);
    const [plannerOpen, setPlannerOpen] = useState(false);
    const plannerOpenRef = useRef(false);
    const priorWorkspaceAccessRef = useRef(false);
    const pendingProjectRequestRef = useRef(null);
    const activeProjectIdRef = useRef(null);
    const snapshotSignaturesRef = useRef(new Map());
    const notifications = useOrbitNotifications();
    const operations = useOrbitOperations();
    const {
        isOpen: welcomeOpen,
        runtimeStatus,
        open: openProjectHub
    } = useProjectWelcome();
    // One application-level stream keeps BIT current after startup as well.
    // It deliberately never stops at project readiness: a later cache, frame
    // or force-model degradation must remain observable in the same BIT.
    const systemDiagnostics = useSystemDiagnostics({ pollIntervalMs: 2_500 });
    const initialBitWarning = useInitialBitWarningNotice(systemDiagnostics.diagnostics);
    const startup = useStartupStatus(systemDiagnostics);
    const startupPresentation = useStartupWelcomePresentation({
        startup,
        diagnostics: systemDiagnostics.diagnostics,
        availability: systemDiagnostics.availability
    });
    const bitStatus = useMemo(() => continuousBitStatus(systemDiagnostics), [
        systemDiagnostics.availability,
        systemDiagnostics.diagnostics,
        systemDiagnostics.local
    ]);
    const startupReadiness = useMemo(() => getStartupProjectReadiness(startup), [startup]);
    const startupReady = getStartupProjectReadiness(startup).ready;
    const startupPreparing = !startupReady || startupPresentation?.isPreparing !== false;
    const projectReadiness = runtimeStatus?.state === "failed"
        ? { ready: false, message: "El visor no se pudo iniciar. Recarga Orbit para volver a intentarlo." }
        : startupReadiness;

    activeProjectIdRef.current = userProjects.activeProjectId;

    const closePlanner = useCallback(() => {
        if (!plannerOpenRef.current) return;
        plannerOpenRef.current = false;
        window.dispatchEvent(new Event(ORBIT_PLANNER_CLOSE_EVENT));
        setPlannerOpen(false);
    }, []);
    const openPlanner = useCallback(({ announce = true } = {}) => {
        if (!regularWorkspace || plannerOpenRef.current) return;
        plannerOpenRef.current = true;
        setPlannerOpen(true);
        // The runtime owns the scene-wide forecast. Publishing after the
        // synchronous guard is set makes toolbar and external commands alike.
        if (announce) window.dispatchEvent(new Event(ORBIT_PLANNER_OPEN_EVENT));
    }, [regularWorkspace]);
    const togglePlanner = useCallback(() => {
        if (plannerOpenRef.current) closePlanner();
        else openPlanner();
    }, [closePlanner, openPlanner]);

    useEffect(() => {
        if (regularWorkspace) setRuntimeMounted(true);
    }, [regularWorkspace]);

    // The legacy runtime checks this synchronously before accepting a project
    // command. Keep the public browser bridge fail-closed until the identity
    // panel has completed the current provider flow.
    useEffect(() => {
        if (typeof window === "undefined") return;
        window.__orbitIdentityAccessRequired = true;
        window.__orbitIdentitySession = regularWorkspace ? identity.session : null;
        const hadWorkspaceAccess = priorWorkspaceAccessRef.current;
        if (hadWorkspaceAccess && !regularWorkspace) {
            closePlanner();
            setHelpOpen(false);
            setDiagnosticsOpen(false);
            setNotificationsOpen(false);
            setOperationsOpen(false);
            const pending = pendingProjectRequestRef.current;
            pendingProjectRequestRef.current = null;
            pending?.resolve(false);
            activeProjectIdRef.current = null;
            snapshotSignaturesRef.current.clear();
            window.dispatchEvent(new Event("orbit:identity-logout"));
            openProjectHub();
        }
        priorWorkspaceAccessRef.current = regularWorkspace;
    }, [regularWorkspace, closePlanner, identity.session, openProjectHub]);

    // Startup has a bounded lifecycle and is therefore a genuine operation.
    // Continuous BIT refreshes are deliberately excluded: their status stays
    // on the BIT icon and must never make the activity indicator spin forever.
    useEffect(() => {
        if (!startupPreparing) {
            completeOperation({ id: "startup-readiness" });
            return;
        }
        const pendingStep = Array.isArray(startup?.steps)
            ? startup.steps.find((step) => ["pending", "running", "queued", "loading"].includes(String(step?.status || "").toLowerCase()))
            : null;
        const progress = Number.isFinite(Number(startup?.progress?.percent)) ? Number(startup.progress.percent) : null;
        startOperation({
            id: "startup-readiness",
            title: "Preparando Orbit",
            scope: OPERATION_SCOPES.SYSTEM,
            stage: pendingStep?.label || "Comprobando recursos de inicio",
            progress,
            message: pendingStep?.message || startupPresentation?.phase || "Esperando la validación de recursos.",
            cancellable: false
        });
    }, [startup, startupPreparing, startupPresentation?.phase]);

    useEffect(() => {
        if (operations.length === 0) setOperationsOpen(false);
    }, [operations.length]);

    useEffect(() => () => {
        // Covers an application teardown while the modal is open without
        // duplicating the ordinary close path above.
        if (!plannerOpenRef.current) return;
        plannerOpenRef.current = false;
        window.dispatchEvent(new Event(ORBIT_PLANNER_CLOSE_EVENT));
    }, []);

    useEffect(() => {
        const openHelp = () => { if (regularWorkspace) setHelpOpen(true); };
        const openDiagnostics = () => { if (regularWorkspace) setDiagnosticsOpen(true); };
        const openOperations = () => { if (regularWorkspace) setOperationsOpen(true); };
        // An external command has already notified the runtime. Do not emit a
        // nested duplicate merely to mount the React surface.
        const openPlannerFromEvent = () => openPlanner({ announce: false });
        window.addEventListener("orbit:help-open", openHelp);
        window.addEventListener("orbit:diagnostics-open", openDiagnostics);
        window.addEventListener("orbit:operations-open", openOperations);
        window.addEventListener(ORBIT_PLANNER_OPEN_EVENT, openPlannerFromEvent);
        return () => {
            window.removeEventListener("orbit:help-open", openHelp);
            window.removeEventListener("orbit:diagnostics-open", openDiagnostics);
            window.removeEventListener("orbit:operations-open", openOperations);
            window.removeEventListener(ORBIT_PLANNER_OPEN_EVENT, openPlannerFromEvent);
        };
    }, [regularWorkspace, openPlanner]);

    // The renderer produces snapshots only in the browser. A short debounce
    // keeps an interactive planner/layer edit local and durable without
    // turning every render tick into a storage write. The encrypted library
    // owns the actual serialisation and rejects stale capabilities on logout.
    useEffect(() => {
        if (!regularWorkspace || !userProjects.ready) return undefined;
        let disposed = false;
        let dirtyTimer = null;
        const persistSnapshot = (event) => {
            const projectDocument = event?.detail?.document;
            const pending = pendingProjectRequestRef.current;
            // A replacement may display its confirmation dialog while the old
            // project is still live, or fail after the renderer has reset the
            // old scene.  Until a final `opened` handoff proves success, no
            // ordinary dirty/checkpoint snapshot may be saved at all: mapping
            // it to either record could overwrite a sound encrypted project
            // with an old or partially restored scene.
            if (pending && event?.detail?.reason !== "opened") return;
            const projectId = pending ? pending.projectId : activeProjectIdRef.current;
            if (!projectDocument || typeof projectDocument !== "object" || !projectId) return;
            const signature = projectSnapshotSignature(projectDocument);
            if (signature && snapshotSignaturesRef.current.get(projectId) === signature) return;
            if (signature) snapshotSignaturesRef.current.set(projectId, signature);
            void userProjects.saveProject(projectId, projectDocument).catch(() => {
                if (!disposed && signature && snapshotSignaturesRef.current.get(projectId) === signature) {
                    snapshotSignaturesRef.current.delete(projectId);
                }
            });
        };
        const requestSnapshot = (reason) => {
            if (pendingProjectRequestRef.current || !activeProjectIdRef.current) return;
            window.dispatchEvent(new CustomEvent("orbit:project-document-snapshot-request", {
                detail: { reason }
            }));
        };
        const markDirty = () => {
            if (dirtyTimer !== null) window.clearTimeout(dirtyTimer);
            dirtyTimer = window.setTimeout(() => {
                dirtyTimer = null;
                requestSnapshot("autosave");
            }, 650);
        };
        const projectCommandComplete = (event) => {
            const detail = event?.detail || {};
            const pending = pendingProjectRequestRef.current;
            if (!pending || detail?.requestId !== pending.requestId || detail?.type !== "open") return;
            pendingProjectRequestRef.current = null;
            if (detail.accepted === true) {
                // Set the ref synchronously too: a close/checkpoint in the
                // same turn must already target the project just opened.
                activeProjectIdRef.current = pending.projectId;
                userProjects.setActiveProjectId(pending.projectId);
                pending.resolve(true);
                return;
            }
            snapshotSignaturesRef.current.delete(pending.projectId);
            if (detail.reason === "project-open-failed-after-reset") {
                // The renderer may now hold only a partial scene. Keep the
                // prior encrypted record intact, but stop calling it active
                // until the operator explicitly opens a project again.
                activeProjectIdRef.current = null;
                userProjects.setActiveProjectId(null);
            }
            pending.resolve(false);
        };
        const runtimeFailed = (event) => {
            if (event?.detail?.state !== "failed") return;
            const pending = pendingProjectRequestRef.current;
            if (!pending) return;
            pendingProjectRequestRef.current = null;
            snapshotSignaturesRef.current.delete(pending.projectId);
            pending.resolve(false);
        };
        const checkpoint = () => {
            if (dirtyTimer !== null) {
                window.clearTimeout(dirtyTimer);
                dirtyTimer = null;
            }
            requestSnapshot("checkpoint");
        };
        const visibilityCheckpoint = () => {
            if (document.visibilityState === "hidden") checkpoint();
        };
        window.addEventListener("orbit:project-document-snapshot", persistSnapshot);
        window.addEventListener("orbit:project-document-dirty", markDirty);
        window.addEventListener("orbit:project-command-complete", projectCommandComplete);
        window.addEventListener(ORBIT_RUNTIME_STATUS_EVENT, runtimeFailed);
        window.addEventListener("beforeunload", checkpoint);
        document.addEventListener("visibilitychange", visibilityCheckpoint);
        return () => {
            disposed = true;
            if (dirtyTimer !== null) window.clearTimeout(dirtyTimer);
            window.removeEventListener("orbit:project-document-snapshot", persistSnapshot);
            window.removeEventListener("orbit:project-document-dirty", markDirty);
            window.removeEventListener("orbit:project-command-complete", projectCommandComplete);
            window.removeEventListener(ORBIT_RUNTIME_STATUS_EVENT, runtimeFailed);
            window.removeEventListener("beforeunload", checkpoint);
            document.removeEventListener("visibilitychange", visibilityCheckpoint);
        };
    }, [regularWorkspace, userProjects.activeProjectId, userProjects.ready, userProjects.saveProject, userProjects.setActiveProjectId]);

    const startProjectAction = useCallback((action) => {
        if (!regularWorkspace || runtimeStatus.state === "failed") return;
        if (!startupPresentation.allowProjectActions || !startupReadiness.ready) return;
        if (action === "new" || action === "open") {
            window.dispatchEvent(new CustomEvent("orbit:project-dialog-request", { detail: action }));
        }
    }, [regularWorkspace, runtimeStatus.state, startupPresentation.allowProjectActions, startupReadiness.ready]);

    const openProjectDocument = useCallback(async (projectDocument, metadata) => {
        if (!regularWorkspace) return false;
        const projectId = String(metadata?.id || "").trim();
        if (!projectId || !projectDocument || typeof projectDocument !== "object") {
            throw new Error("El proyecto local no tiene un documento válido.");
        }
        const FileConstructor = globalThis.File;
        if (typeof FileConstructor !== "function") {
            throw new Error("Este navegador no puede abrir documentos locales de Orbit.");
        }
        const file = new FileConstructor([
            JSON.stringify(projectDocument)
        ], portableProjectFileName(metadata?.name || projectDocument.name), { type: "application/json" });
        if (pendingProjectRequestRef.current) {
            throw new Error("Ya se está abriendo otro proyecto local.");
        }
        const signature = projectSnapshotSignature(projectDocument);
        if (signature) snapshotSignaturesRef.current.set(projectId, signature);
        const requestId = nextProjectCommandRequestId();
        return new Promise((resolve, reject) => {
            pendingProjectRequestRef.current = { requestId, projectId, resolve };
            const result = requestProjectCommand({ type: "open", file, requestId });
            if (result.accepted) return;
            if (pendingProjectRequestRef.current?.requestId === requestId) {
                pendingProjectRequestRef.current = null;
            }
            snapshotSignaturesRef.current.delete(projectId);
            reject(new Error(result.reason || "No se pudo abrir el proyecto local."));
        });
    }, [regularWorkspace]);

    const exportActiveProject = useCallback(async (projectId) => {
        if (!regularWorkspace || String(projectId || "") !== String(activeProjectIdRef.current || "")) return false;
        window.dispatchEvent(new CustomEvent("orbit:project-action", { detail: "export" }));
        return true;
    }, [regularWorkspace]);

    const signOut = useCallback(() => {
        identity.signOut();
        openProjectHub();
    }, [identity, openProjectHub]);

    const projectHub = regularWorkspace ? <UserProjectHub
        session={identity.session}
        library={userProjects}
        startupReadiness={projectReadiness}
        onOpenDocument={openProjectDocument}
        onExportProject={exportActiveProject}
        onSignOut={signOut}
        hasNotifications={notifications.length > 0}
        notificationsOpen={notificationsOpen}
        onToggleNotifications={() => setNotificationsOpen((value) => !value)}
    /> : null;

    return <>
        {regularWorkspace && runtimeMounted && <CesiumGlobe />}
        {regularWorkspace && <>
            <TopToolbar
                hasNotifications={notifications.length > 0}
                activeOperationCount={operations.length}
                operationsOpen={operationsOpen}
                plannerOpen={plannerOpen}
                notificationsOpen={notificationsOpen}
                diagnosticsStatus={bitStatus}
                identitySession={identity.session}
                onOpenProjectHub={openProjectHub}
                onSignOut={signOut}
                onToggleOperations={() => setOperationsOpen((value) => !value)}
                onTogglePlanner={togglePlanner}
                onToggleNotifications={() => setNotificationsOpen((value) => !value)}
                onToggleHelp={() => setHelpOpen((value) => !value)}
                onToggleDiagnostics={() => setDiagnosticsOpen((value) => !value)}
            />
            <OrbitOverlays />
            <TimeControlBar />
            {welcomeOpen && <ProjectWelcome
                onAction={startProjectAction}
                runtimeStatus={runtimeStatus}
                startup={startup}
                startupPresentation={startupPresentation}
                projectHub={projectHub}
            />}
            {plannerOpen && <PlannerPanel onClose={closePlanner} />}
            {operationsOpen && <OperationsPanel operations={operations} onClose={() => setOperationsOpen(false)} />}
            {notificationsOpen && <NotificationCenter notifications={notifications} onClose={() => setNotificationsOpen((value) => !value)} />}
            {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
            {diagnosticsOpen && <BuiltInTestPanel onClose={() => setDiagnosticsOpen(false)} diagnosticsState={systemDiagnostics} />}
            <InitialBitWarningNotice notice={initialBitWarning.notice} onDismiss={initialBitWarning.dismiss} onOpenDiagnostics={() => setDiagnosticsOpen(true)} />
        </>}
        {administratorWorkspace && <UserAdministrationPanel
            session={identity.session}
            administration={identity.administration}
            onSignOut={identity.signOut}
        />}
        {!regularWorkspace && !administratorWorkspace && <IdentityGate identity={identity} />}
    </>;
}
