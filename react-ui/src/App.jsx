import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CesiumGlobe from "./components/CesiumGlobe.jsx";
import TopToolbar from "./components/layout/TopToolbar.jsx";
import BuiltInTestPanel from "./components/overlays/BuiltInTestPanel.jsx";
import HelpPanel from "./components/overlays/HelpPanel.jsx";
import NotificationCenter from "./components/overlays/NotificationCenter.jsx";
import OperationsPanel from "./components/overlays/OperationsPanel.jsx";
import OrbitOverlays from "./components/overlays/OrbitOverlays.jsx";
import ProjectWelcome from "./components/overlays/ProjectWelcome.jsx";
import PlannerPanel from "./features/planner/PlannerPanel.jsx";
import TimeControlBar from "./features/simulation/TimeControlBar.jsx";
import { ORBIT_PLANNER_CLOSE_EVENT, ORBIT_PLANNER_OPEN_EVENT } from "./features/planner/plannerUiModel.js";
import useOrbitNotifications from "./hooks/useOrbitNotifications.js";
import useOrbitOperations from "./hooks/useOrbitOperations.js";
import useProjectWelcome from "./hooks/useProjectWelcome.js";
import useStartupStatus from "./hooks/useStartupStatus.js";
import useStartupWelcomePresentation from "./hooks/useStartupWelcomePresentation.js";
import useSystemDiagnostics from "./hooks/useSystemDiagnostics.js";
import { continuousBitStatus } from "../../front/js/features/diagnostics/bitPresentation.js";
import {
    completeOperation,
    OPERATION_SCOPES,
    startOperation
} from "../../front/js/features/operations/operationsContract.js";
import {
    getStartupProjectReadiness
} from "../../front/js/features/diagnostics/startupStatus.js";

export default function App() {
    const [helpOpen, setHelpOpen] = useState(false);
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [operationsOpen, setOperationsOpen] = useState(false);
    const [plannerOpen, setPlannerOpen] = useState(false);
    // Keep this synchronous guard separate from React state: state updater
    // functions can be intentionally replayed by Strict Mode, whereas closing
    // the planner must emit exactly one cancellation signal.
    const plannerOpenRef = useRef(false);
    const notifications = useOrbitNotifications();
    const operations = useOrbitOperations();
    const { isOpen: welcomeOpen, runtimeStatus } = useProjectWelcome();
    // One application-level stream keeps BIT current after startup as well.
    // It deliberately never stops at project readiness: a later cache, frame
    // or force-model degradation must remain observable in the same BIT.
    const systemDiagnostics = useSystemDiagnostics({ pollIntervalMs: 2_500 });
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
    const startupReady = getStartupProjectReadiness(startup).ready;
    const startupPreparing = !startupReady || startupPresentation?.isPreparing !== false;

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
    const startProjectAction = (action) => {
        if (runtimeStatus.state === "failed") return;
        if (!startupPresentation.allowProjectActions) return;
        if (!getStartupProjectReadiness(startup).ready) return;
        if (action === "new" || action === "open") {
            window.dispatchEvent(new CustomEvent("orbit:project-dialog-request", { detail: action }));
        }
    };
    const closePlanner = useCallback(() => {
        if (!plannerOpenRef.current) return;
        plannerOpenRef.current = false;
        window.dispatchEvent(new Event(ORBIT_PLANNER_CLOSE_EVENT));
        setPlannerOpen(false);
    }, []);
    const openPlanner = useCallback(({ announce = true } = {}) => {
        if (plannerOpenRef.current) return;
        plannerOpenRef.current = true;
        setPlannerOpen(true);
        // The runtime owns the scene-wide forecast.  Publishing after the
        // synchronous guard is set makes the toolbar path and external
        // "open planner" commands equivalent without re-entering this
        // listener when the event comes back through App.
        if (announce) window.dispatchEvent(new Event(ORBIT_PLANNER_OPEN_EVENT));
    }, []);
    const togglePlanner = useCallback(() => {
        if (plannerOpenRef.current) closePlanner();
        else openPlanner();
    }, [closePlanner, openPlanner]);

    useEffect(() => () => {
        // Covers an application teardown while the modal is open without
        // duplicating the ordinary close path above.
        if (!plannerOpenRef.current) return;
        plannerOpenRef.current = false;
        window.dispatchEvent(new Event(ORBIT_PLANNER_CLOSE_EVENT));
    }, []);

    useEffect(() => {
        const openHelp = () => setHelpOpen(true);
        const openDiagnostics = () => setDiagnosticsOpen(true);
        const openOperations = () => setOperationsOpen(true);
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
    }, [openPlanner]);
    return <><TopToolbar hasNotifications={notifications.length > 0} activeOperationCount={operations.length} operationsOpen={operationsOpen} plannerOpen={plannerOpen} diagnosticsStatus={bitStatus} onToggleOperations={() => setOperationsOpen((value) => !value)} onTogglePlanner={togglePlanner} onToggleNotifications={() => setNotificationsOpen((value) => !value)} onToggleHelp={() => setHelpOpen((value) => !value)} onToggleDiagnostics={() => setDiagnosticsOpen((value) => !value)} /><CesiumGlobe /><OrbitOverlays /><TimeControlBar />{welcomeOpen && <ProjectWelcome onAction={startProjectAction} runtimeStatus={runtimeStatus} startup={startup} startupPresentation={startupPresentation} />}{plannerOpen && <PlannerPanel onClose={closePlanner} />}{operationsOpen && <OperationsPanel operations={operations} onClose={() => setOperationsOpen(false)} />}{notificationsOpen && <NotificationCenter notifications={notifications} onClose={() => setNotificationsOpen((value) => !value)} />}{helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}{diagnosticsOpen && <BuiltInTestPanel onClose={() => setDiagnosticsOpen(false)} diagnosticsState={systemDiagnostics} />}</>;
}
