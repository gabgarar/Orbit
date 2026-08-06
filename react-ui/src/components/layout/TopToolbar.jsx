import { useEffect, useState } from "react";
import GlobalSearch from "../GlobalSearch.jsx";
import { BellIcon, ControlPanelIcon, HelpIcon } from "../icons.jsx";

const navigation = ["Dashboard", "Satellites", "Missions", "Ground Stations", "Analytics"];
const availableNavigation = new Set(["Satellites", "Ground Stations"]);

const iconButtonClass = "toolbar-icon-btn toolbar-vector-icon !relative !grid !h-[30px] !w-[27px] !place-items-center !border-0 !bg-transparent !p-0 !text-[#aebbd1] !cursor-pointer hover:!text-[#e4ebff] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[#7198ff] [&>svg]:!h-[21px] [&>svg]:!w-[21px] [&>svg]:!fill-none [&>svg]:!stroke-current [&>svg]:!stroke-[1.8] [&>svg]:!stroke-linecap-round [&>svg]:!stroke-linejoin-round max-[620px]:!h-8 max-[620px]:!w-[26px] max-[620px]:[&>svg]:!h-[18px] max-[620px]:[&>svg]:!w-[18px]";

function NavigationIcon({ name }) {
    const paths = {
        Dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
        Satellites: <><path d="m12 8 4 4-4 4-4-4zM8 9 4 5M16 15l4 4M15 9l4-4M9 15l-4 4" /><path d="M3 5h3M18 5h3M3 19h3M18 19h3" /></>,
        Missions: <><circle cx="12" cy="12" r="7" /><path d="m9 12 2 2 4-5" /></>,
        "Ground Stations": <><path d="M4 20h16M8 20l2-9h4l2 9M8 8a4 4 0 0 1 8 0" /><path d="M5 5a10 10 0 0 1 14 0" /></>,
        Analytics: <><path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" /></>
    };

    return <svg className="!h-4 !w-4 !fill-none !stroke-current !stroke-[1.7] !stroke-linecap-round !stroke-linejoin-round" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function NavigationItem({ label, active, onActivate }) {
    const available = availableNavigation.has(label);
    const stateClass = active
        ? "active !text-[#e2eaff] after:!absolute after:!inset-x-0 after:!bottom-0 after:!h-0.5 after:!rounded-t-sm after:!bg-[#2f63ff] after:!shadow-[0_0_10px_#2f63ff]"
        : "max-[820px]:!hidden";

    return <button
        type="button"
        disabled={!available}
        onClick={() => available && onActivate?.(label)}
        className={`toolbar-nav-link !relative !inline-flex !h-full !items-center !gap-[7px] !border-0 !bg-transparent !p-0 !font-[system-ui,sans-serif] !text-[clamp(14px,1.25vw,18px)] !leading-none !font-semibold !whitespace-nowrap !text-[#a5afc5] ${available ? "!cursor-pointer" : "!cursor-not-allowed !opacity-40"} ${stateClass}`}
        aria-current={active ? "page" : undefined}
        title={available ? undefined : "Próximamente"}
    >
        <span className="toolbar-nav-icon !inline-flex !items-center !justify-center !text-[#7198ff]"><NavigationIcon name={label} /></span>
        {label}
    </button>;
}

export default function TopToolbar({ hasNotifications, onToggleNotifications, onToggleHelp }) {
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
    return <header
        id="topToolbar"
        className="!fixed !top-0 !right-0 !left-0 !z-[10100] !flex !h-[max(64px,calc(76px*var(--orbit-ui-scale)))] !min-w-0 !items-center !gap-[clamp(14px,1.5vw,22px)] !border-b !border-[rgba(80,116,180,.22)] !bg-[linear-gradient(90deg,#02060e_0%,#070d19_56%,#02060d_100%)] !px-[clamp(14px,2vw,28px)] !shadow-[0_5px_20px_rgba(0,0,0,.3)] max-[1100px]:!gap-[14px] max-[1100px]:!px-[14px] max-[820px]:!h-14 max-[820px]:!gap-2.5 max-[820px]:!px-2.5 max-[620px]:!gap-1.5 max-[620px]:!px-1.5"
    >
        <a className="toolbar-brand !inline-flex !shrink-0 !items-center !gap-[clamp(6px,1vw,13px)] !mr-[clamp(8px,2vw,28px)] !font-[system-ui,sans-serif] !text-[clamp(16px,1.7vw,28px)] !leading-[1.05] !font-bold !tracking-[clamp(3px,.45vw,7px)] !text-[#3e6bff] !no-underline max-[620px]:!mr-0 max-[620px]:!gap-0" href="#" aria-label="Orbit">
            <img className="!block !h-[max(32px,calc(36px*var(--orbit-ui-scale)))] !w-[max(32px,calc(36px*var(--orbit-ui-scale)))] !object-contain max-[620px]:!hidden" src="/assets/icon/favicon.svg" alt="" />
            <span>ORBIT</span>
        </a>
        <nav className="toolbar-nav !flex !min-w-0 !self-stretch !items-center !gap-[clamp(12px,1.5vw,23px)] max-[620px]:!flex-none max-[620px]:!gap-0" aria-label="Navegacion principal">
            {navigation.map((label) => <NavigationItem label={label} active={activeSection === label} key={label} onActivate={(target) => {
                setActiveSection(target);
                if (target === "Ground Stations") window.dispatchEvent(new Event("orbit:ground-stations-open"));
                if (target === "Satellites") window.dispatchEvent(new Event("orbit:ground-stations-close"));
            }} />)}
        </nav>
        <div className="toolbar-spacer !flex-1 max-[620px]:!hidden" />
        <GlobalSearch />
        <div className="toolbar-actions !flex !shrink-0 !items-center !gap-[clamp(5px,1vw,16px)] max-[820px]:!gap-2 max-[620px]:!gap-[5px]">
            <span className="toolbar-action-divider !h-7 !w-px !bg-[rgba(117,143,190,.32)] max-[620px]:!hidden" aria-hidden="true" />
            <button id="topNotificationsBtn" className={iconButtonClass} type="button" aria-label="Alertas" onClick={onToggleNotifications}>
                <BellIcon />
                {hasNotifications && <span className="absolute top-px right-0 h-[7px] w-[7px] rounded-full border-2 border-[#07101d] bg-[#ff4b38]" aria-hidden="true" />}
            </button>
            <button className={iconButtonClass} type="button" aria-label="Panel de ayuda" onClick={onToggleHelp}><HelpIcon /></button>
            <button id="topSettingsBtn" data-react-owned="true" className={iconButtonClass} type="button" aria-label="Configuracion general" onClick={() => window.dispatchEvent(new Event("orbit:config-panel-toggle"))}><ControlPanelIcon /></button>
            <span className="toolbar-action-divider !h-7 !w-px !bg-[rgba(117,143,190,.32)] max-[620px]:!hidden" aria-hidden="true" />
            <button id="topUserBtn" className="toolbar-avatar !grid !h-10 !w-10 !place-items-center !rounded-full !border-0 !bg-[linear-gradient(145deg,#293a9c,#17235e)] !p-0 !font-[system-ui,sans-serif] !text-sm !leading-none !font-semibold !text-[#e6ebff] !cursor-pointer focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[#7198ff] max-[620px]:!hidden" type="button" aria-label="Perfil de GG">GG</button>
        </div>
    </header>;
}
