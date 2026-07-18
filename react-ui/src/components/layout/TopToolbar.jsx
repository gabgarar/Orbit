import GlobalSearch from "../GlobalSearch.jsx";
import { BellIcon, ControlPanelIcon, HelpIcon } from "../icons.jsx";

const navigation = ["Dashboard", "Satellites", "Missions", "Ground Stations", "Analytics"];

function NavigationIcon({ name }) {
    const paths = {
        Dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
        Satellites: <><path d="m12 8 4 4-4 4-4-4zM8 9 4 5M16 15l4 4M15 9l4-4M9 15l-4 4" /><path d="M3 5h3M18 5h3M3 19h3M18 19h3" /></>,
        Missions: <><circle cx="12" cy="12" r="7" /><path d="m9 12 2 2 4-5" /></>,
        "Ground Stations": <><path d="M4 20h16M8 20l2-9h4l2 9M8 8a4 4 0 0 1 8 0" /><path d="M5 5a10 10 0 0 1 14 0" /></>,
        Analytics: <><path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" /></>
    };
    return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function TopToolbar({ hasNotifications, onToggleNotifications, onToggleHelp }) {
    return <header id="topToolbar"><a className="toolbar-brand" href="#" aria-label="Orbit"><img src="/assets/icon/favicon.png" alt="" /><span>ORBIT</span></a><nav className="toolbar-nav" aria-label="Navegacion principal">{navigation.map((label) => <span className={`toolbar-nav-link${label === "Satellites" ? " active" : ""}`} aria-current={label === "Satellites" ? "page" : undefined} key={label}><span className="toolbar-nav-icon"><NavigationIcon name={label} /></span>{label}</span>)}</nav><div className="toolbar-spacer" /><GlobalSearch /><div className="toolbar-actions"><span className="toolbar-action-divider" aria-hidden="true" /><button id="topNotificationsBtn" className={`toolbar-icon-btn toolbar-vector-icon${hasNotifications ? " has-notification" : ""}`} type="button" aria-label="Alertas" onClick={onToggleNotifications}><BellIcon /></button><button className="toolbar-icon-btn toolbar-vector-icon" type="button" aria-label="Panel de ayuda" onClick={onToggleHelp}><HelpIcon /></button><button id="topSettingsBtn" data-react-owned="true" className="toolbar-icon-btn toolbar-vector-icon" type="button" aria-label="Configuracion general" onClick={() => window.dispatchEvent(new Event("orbit:config-panel-toggle"))}><ControlPanelIcon /></button><span className="toolbar-action-divider" aria-hidden="true" /><button id="topUserBtn" className="toolbar-avatar" type="button" aria-label="Perfil de GG">GG</button></div></header>;
}
