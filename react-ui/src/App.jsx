import { useEffect, useMemo, useState } from "react";
import CesiumGlobe from "./components/CesiumGlobe.jsx";
import TopToolbar from "./components/layout/TopToolbar.jsx";
import BuiltInTestPanel from "./components/overlays/BuiltInTestPanel.jsx";
import HelpPanel from "./components/overlays/HelpPanel.jsx";
import NotificationCenter from "./components/overlays/NotificationCenter.jsx";
import OperationsPanel from "./components/overlays/OperationsPanel.jsx";
import OrbitOverlays from "./components/overlays/OrbitOverlays.jsx";
import ProjectWelcome from "./components/overlays/ProjectWelcome.jsx";
import TimeControlBar from "./features/simulation/TimeControlBar.jsx";
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
    useEffect(() => {
        const openHelp = () => setHelpOpen(true);
        const openDiagnostics = () => setDiagnosticsOpen(true);
        const openOperations = () => setOperationsOpen(true);
        window.addEventListener("orbit:help-open", openHelp);
        window.addEventListener("orbit:diagnostics-open", openDiagnostics);
        window.addEventListener("orbit:operations-open", openOperations);
        return () => {
            window.removeEventListener("orbit:help-open", openHelp);
            window.removeEventListener("orbit:diagnostics-open", openDiagnostics);
            window.removeEventListener("orbit:operations-open", openOperations);
        };
    }, []);
    return <><TopToolbar hasNotifications={notifications.length > 0} activeOperationCount={operations.length} operationsOpen={operationsOpen} diagnosticsStatus={bitStatus} onToggleOperations={() => setOperationsOpen((value) => !value)} onToggleNotifications={() => setNotificationsOpen((value) => !value)} onToggleHelp={() => setHelpOpen((value) => !value)} onToggleDiagnostics={() => setDiagnosticsOpen((value) => !value)} /><CesiumGlobe /><OrbitOverlays /><TimeControlBar />{welcomeOpen && <ProjectWelcome onAction={startProjectAction} runtimeStatus={runtimeStatus} startup={startup} startupPresentation={startupPresentation} />}{operationsOpen && <OperationsPanel operations={operations} onClose={() => setOperationsOpen(false)} />}{notificationsOpen && <NotificationCenter notifications={notifications} onClose={() => setNotificationsOpen((value) => !value)} />}{helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}{diagnosticsOpen && <BuiltInTestPanel onClose={() => setDiagnosticsOpen(false)} diagnosticsState={systemDiagnostics} />}</>;
}
