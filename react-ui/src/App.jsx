import { useEffect, useState } from "react";
import CesiumGlobe from "./components/CesiumGlobe.jsx";
import TopToolbar from "./components/layout/TopToolbar.jsx";
import BuiltInTestPanel from "./components/overlays/BuiltInTestPanel.jsx";
import HelpPanel from "./components/overlays/HelpPanel.jsx";
import NotificationCenter from "./components/overlays/NotificationCenter.jsx";
import OrbitOverlays from "./components/overlays/OrbitOverlays.jsx";
import ProjectWelcome from "./components/overlays/ProjectWelcome.jsx";
import TimeControlBar from "./features/simulation/TimeControlBar.jsx";
import useOrbitNotifications from "./hooks/useOrbitNotifications.js";
import useProjectWelcome from "./hooks/useProjectWelcome.js";

export default function App() {
    const [helpOpen, setHelpOpen] = useState(false);
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const notifications = useOrbitNotifications();
    const { isOpen: welcomeOpen, runtimeStatus } = useProjectWelcome();
    const startProjectAction = (action) => {
        if (runtimeStatus.state === "failed") return;
        if (action === "new" || action === "open") {
            window.dispatchEvent(new CustomEvent("orbit:project-dialog-request", { detail: action }));
        }
    };
    useEffect(() => {
        const openHelp = () => setHelpOpen(true);
        const openDiagnostics = () => setDiagnosticsOpen(true);
        window.addEventListener("orbit:help-open", openHelp);
        window.addEventListener("orbit:diagnostics-open", openDiagnostics);
        return () => {
            window.removeEventListener("orbit:help-open", openHelp);
            window.removeEventListener("orbit:diagnostics-open", openDiagnostics);
        };
    }, []);
    return <><TopToolbar hasNotifications={notifications.length > 0} onToggleNotifications={() => setNotificationsOpen((value) => !value)} onToggleHelp={() => setHelpOpen((value) => !value)} onToggleDiagnostics={() => setDiagnosticsOpen((value) => !value)} /><CesiumGlobe /><OrbitOverlays /><TimeControlBar />{welcomeOpen && <ProjectWelcome onAction={startProjectAction} runtimeStatus={runtimeStatus} />}{notificationsOpen && <NotificationCenter notifications={notifications} onClose={() => setNotificationsOpen(false)} />}{helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}{diagnosticsOpen && <BuiltInTestPanel onClose={() => setDiagnosticsOpen(false)} />}</>;
}
