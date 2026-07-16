import { useEffect, useState } from "react";
import CesiumGlobe from "./components/CesiumGlobe.jsx";
import WorkspaceSidebar from "./components/WorkspaceSidebar.jsx";
import { BellIcon, HelpIcon, SettingsIcon } from "./components/icons.jsx";

const navigation = [["Dashboard", "⌘"], ["Satellites", "⌁"], ["Missions", "◷"], ["Ground Stations", "⌖"], ["Analytics", "⌁"]];

function TimeControlBar() {
    const [collapsed, setCollapsed] = useState(false);
    const [now, setNow] = useState(new Date());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    const clickLegacy = (id) => document.getElementById(id)?.click();
    return <>
        <section className={`react-time-control${collapsed ? " is-collapsed" : ""}`} aria-label="Control de tiempo">
            <div className="react-time-status"><span>{now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span><strong>{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} UTC</strong><small><i />Tiempo real</small></div>
            <div className="react-time-playback"><button type="button" onClick={() => clickLegacy("simRestartBtn")}>|◀</button><button className="react-time-primary" type="button" onClick={() => clickLegacy("simPlayPauseBtn")}>▶</button><button type="button" onClick={() => clickLegacy("simStopBtn")}>▶|</button><button className="react-time-speed" type="button">1×⌄</button></div>
            <div className="react-time-timeline"><input type="range" min="0" max="100" defaultValue="50" onChange={(event) => { const control = document.getElementById("simTimeline"); if (control) { control.value = String(Number(event.target.value) * 100); control.dispatchEvent(new Event("input", { bubbles: true })); } }} /><div><span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>24:00</span></div></div>
            <button className="react-time-live" type="button">Live ↻</button>
        </section>
        <button className={`react-time-collapse${collapsed ? " is-collapsed" : ""}`} type="button" onClick={() => setCollapsed((value) => !value)}>{collapsed ? "◀" : "⌄"}</button>
    </>;
}

export default function App() {
    const [helpOpen, setHelpOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const hasNotifications = notifications.length > 0;

    useEffect(() => {
        const syncNotifications = (event) => setNotifications(Array.isArray(event.detail) ? event.detail : []);
        window.addEventListener("orbit:notifications", syncNotifications);
        return () => window.removeEventListener("orbit:notifications", syncNotifications);
    }, []);
    return <>
        <header id="topToolbar">
            <a className="toolbar-brand" href="#" aria-label="Orbit"><img src="/assets/icon/favicon.png" alt="" /><span>ORBIT</span></a>
            <nav className="toolbar-nav" aria-label="Navegación principal">{navigation.map(([label, icon]) => <span className={`toolbar-nav-link${label === "Satellites" ? " active" : ""}`} aria-current={label === "Satellites" ? "page" : undefined} key={label}><span className="toolbar-nav-icon">{icon}</span>{label}</span>)}</nav>
            <div className="toolbar-spacer" />
            <div className="toolbar-search-wrap"><span className="toolbar-search-icon" aria-hidden="true">⌕</span><input id="objectSearch" className="toolbar-search" type="text" placeholder="Buscar satélite por nombre o NORAD..." autoComplete="off" spellCheck="false" /><div id="topSearchSuggestions" /></div>
            <div className="toolbar-actions"><span className="toolbar-action-divider" aria-hidden="true" /><button id="topNotificationsBtn" className={`toolbar-icon-btn toolbar-vector-icon${hasNotifications ? " has-notification" : ""}`} type="button" aria-label="Alertas" onClick={() => setNotificationsOpen((value) => !value)}><BellIcon /></button><button className="toolbar-icon-btn toolbar-vector-icon" type="button" aria-label="Panel de ayuda" onClick={() => setHelpOpen((value) => !value)}><HelpIcon /></button><button id="topSettingsBtn" className="toolbar-icon-btn toolbar-vector-icon" type="button" aria-label="Configuración"><SettingsIcon /></button><span className="toolbar-action-divider" aria-hidden="true" /><button id="topUserBtn" className="toolbar-avatar" type="button" aria-label="Perfil de GG">GG</button></div>
        </header>
        <CesiumGlobe />
        <WorkspaceSidebar />
        <TimeControlBar />
        {notificationsOpen && <section className="react-notification-center" role="dialog" aria-label="Notificaciones"><header><strong>Notificaciones</strong><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Cerrar notificaciones">×</button></header>{notifications.length ? <><div className="react-notification-list">{notifications.map((notification) => <article className={`react-notification-item ${notification.type === "error" ? "is-error" : ""}`} key={notification.id}><button type="button" aria-label="Descartar notificación" onClick={() => window.dispatchEvent(new CustomEvent("orbit:dismiss-notification", { detail: notification.id }))}>×</button><strong>{notification.type === "error" ? "Error" : "Información"}</strong><p>{notification.message}</p></article>)}</div><button className="react-notification-clear" type="button" onClick={() => window.dispatchEvent(new Event("orbit:clear-notifications"))}>Limpiar todo</button></> : <p className="react-notification-empty">No tienes notificaciones.</p>}</section>}
        {helpOpen && <aside className="react-help-panel"><button type="button" onClick={() => setHelpOpen(false)} aria-label="Cerrar ayuda">×</button><strong>Ayuda</strong><p>Busca un satélite, selecciónalo y usa la barra temporal para explorar su órbita.</p></aside>}
    </>;
}
