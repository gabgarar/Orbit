import { useEffect, useState } from "react";
import GlobalSearch from "../GlobalSearch.jsx";
import { BellIcon, ControlPanelIcon, DiagnosticsIcon, HelpIcon } from "../icons.jsx";
import "./TopToolbar.css";

const navigation = ["Dashboard", "Satellites", "Missions", "Ground Stations", "Analytics"];
const availableNavigation = new Set(["Satellites", "Ground Stations"]);

const iconButtonClass = "toolbar-icon-btn toolbar-vector-icon";

function NavigationIcon({ name }) {
    const paths = {
        Dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
        Satellites: <><path d="m12 8 4 4-4 4-4-4zM8 9 4 5M16 15l4 4M15 9l4-4M9 15l-4 4" /><path d="M3 5h3M18 5h3M3 19h3M18 19h3" /></>,
        Missions: <><circle cx="12" cy="12" r="7" /><path d="m9 12 2 2 4-5" /></>,
        "Ground Stations": <><path d="M4 20h16M8 20l2-9h4l2 9M8 8a4 4 0 0 1 8 0" /><path d="M5 5a10 10 0 0 1 14 0" /></>,
        Analytics: <><path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" /></>
    };

    return <svg className="toolbar-nav-icon-svg" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function NavigationItem({ label, active, onActivate }) {
    const available = availableNavigation.has(label);

    return <button
        type="button"
        disabled={!available}
        onClick={() => available && onActivate?.(label)}
        className={`toolbar-nav-link ${available ? "is-available" : "is-unavailable"}${active ? " is-active" : ""}`}
        aria-current={active ? "page" : undefined}
        title={available ? undefined : "Próximamente"}
    >
        <span className="toolbar-nav-icon"><NavigationIcon name={label} /></span>
        {label}
    </button>;
}

export default function TopToolbar({ hasNotifications, onToggleNotifications, onToggleHelp, onToggleDiagnostics }) {
    const [activeSection, setActiveSection] = useState("Satellites");

    useEffect(() => {
        const openGroundStations = () => setActiveSection("Ground Stations");
        const closeGroundStations = () => setActiveSection("Satellites");
        window.addEventListener("orbit:ground-stations-open", openGroundStations);
        window.addEventListener("orbit:ground-stations-close", closeGroundStations);
        return () => {
            window.removeEventListener("orbit:ground-stations-open", openGroundStations);
            window.removeEventListener("orbit:ground-stations-close", closeGroundStations);
        };
    }, []);

    return <header id="topToolbar" className="orbit-top-toolbar">
        <a className="toolbar-brand" href="#" aria-label="Orbit">
            <img className="toolbar-brand-logo" src="/assets/icon/favicon.svg" alt="" />
            <span>ORBIT</span>
        </a>
        <nav className="toolbar-nav" aria-label="Navegacion principal">
            {navigation.map((label) => <NavigationItem label={label} active={activeSection === label} key={label} onActivate={(target) => {
                setActiveSection(target);
                if (target === "Ground Stations") window.dispatchEvent(new Event("orbit:ground-stations-open"));
                if (target === "Satellites") window.dispatchEvent(new Event("orbit:ground-stations-close"));
            }} />)}
        </nav>
        <div className="toolbar-spacer" />
        <GlobalSearch />
        <div className="toolbar-actions">
            <span className="toolbar-action-divider" aria-hidden="true" />
            <button id="topNotificationsBtn" className={iconButtonClass} type="button" aria-label="Alertas" onClick={onToggleNotifications}>
                <BellIcon />
                {hasNotifications && <span className="toolbar-notification-dot" aria-hidden="true" />}
            </button>
            <button className={iconButtonClass} type="button" aria-label="Panel de ayuda" onClick={onToggleHelp}><HelpIcon /></button>
            <button id="topBuiltInTestBtn" data-react-owned="true" className="toolbar-built-in-test-btn toolbar-vector-icon" type="button" aria-label="Built-In Test" title="Built-In Test" onClick={onToggleDiagnostics}><DiagnosticsIcon /><span>Built-In Test</span></button>
            <button id="topSettingsBtn" data-react-owned="true" className={iconButtonClass} type="button" aria-label="Configuracion general" onClick={() => window.dispatchEvent(new Event("orbit:config-panel-toggle"))}><ControlPanelIcon /></button>
            <span className="toolbar-action-divider" aria-hidden="true" />
            <button id="topUserBtn" className="toolbar-avatar" type="button" aria-label="Perfil de GG">GG</button>
        </div>
    </header>;
}
