import { useEffect, useState } from "react";
import { CameraIcon } from "../../components/icons.jsx";

const viewOptions = [
    ["3d", "Vista 3D"],
    ["2d", "Vista 2D"],
    ["columbus", "Columbus"]
];

const navigationOptions = [
    ["centered", "Cámara centrada"],
    ["free", "Cámara libre"]
];

export default function CameraControls() {
    const [open, setOpen] = useState(false);
    const [cameraState, setCameraState] = useState({ viewMode: null, navigationMode: "centered" });
    const send = (type) => window.dispatchEvent(new CustomEvent("orbit:camera-action", { detail: { type } }));
    const select = (type) => { send(type); setOpen(false); };
    const menuItemClass = "rounded-[5px] border-0 bg-transparent px-2.5 py-2 text-left text-xs leading-[1.2] font-semibold text-[#dfe9fa] hover:bg-[#1c3153]";
    const selectedMenuItemClass = " !bg-[#263f6b] !text-[#f4f8ff] shadow-[inset_0_0_0_1px_rgba(123,164,255,.42)]";
    // Reuse this for each menu section heading so titles and their actions
    // remain aligned, with a deliberate visual breath between them.
    const menuSectionTitleClass = "block px-2.5 pb-[5px] text-[10px] font-bold uppercase tracking-[.1em] text-[#91a8ca]";
    const requestCameraState = () => window.dispatchEvent(new Event("orbit:camera-state-request"));
    const toggleOpen = () => {
        setOpen((value) => {
            const next = !value;
            if (next) requestCameraState();
            return next;
        });
    };

    useEffect(() => {
        const onCameraState = (event) => {
            const detail = event.detail || {};
            setCameraState({
                viewMode: ["3d", "2d", "columbus"].includes(detail.viewMode) ? detail.viewMode : null,
                navigationMode: detail.mode === "free" ? "free" : "centered"
            });
        };
        const requestWhenRuntimeIsReady = (event) => {
            if (event.detail?.state === "ready") requestCameraState();
        };
        window.addEventListener("orbit:camera-mode-state", onCameraState);
        window.addEventListener("orbit:runtime-status", requestWhenRuntimeIsReady);
        requestCameraState();
        return () => {
            window.removeEventListener("orbit:camera-mode-state", onCameraState);
            window.removeEventListener("orbit:runtime-status", requestWhenRuntimeIsReady);
        };
    }, []);

    return <div className="relative shrink-0">
        <button id="leftCameraControlsBtn" className={`sidebar-btn${open ? " active" : ""}`} type="button" title="Controles de cámara" aria-label="Controles de cámara" aria-expanded={open} onClick={toggleOpen}><CameraIcon /><span className="sidebar-btn-label" aria-hidden="true">View</span></button>
        {open && <div className="absolute bottom-0 left-[calc(100%+8px)] grid min-w-[176px] rounded-lg border border-[#36548a] bg-[#101c31] p-[5px] shadow-[0_10px_28px_rgba(0,0,0,.35)]" role="menu">
            <button className={menuItemClass} type="button" role="menuitem" onClick={() => select("reset")}>Restablecer vista</button>
            {viewOptions.map(([value, label]) => {
                const selected = cameraState.viewMode === value;
                return <button key={value} className={`${menuItemClass}${selected ? selectedMenuItemClass : ""}`} type="button" role="menuitemradio" aria-checked={selected} aria-current={selected ? "true" : undefined} onClick={() => select(value)}>
                    <span className="flex items-center justify-between gap-3"><span>{label}</span>{selected && <span className="text-[11px] text-[#a9c5ff]" aria-hidden="true">✓</span>}</span>
                </button>;
            })}
            <div className="mt-1 grid gap-[3px] border-t border-[#28415f] pt-2" role="group" aria-label="Navegación">
                <span className={menuSectionTitleClass}>Navegación</span>
                {navigationOptions.map(([value, label]) => {
                    const selected = cameraState.navigationMode === value;
                    return <button key={value} className={`${menuItemClass}${selected ? selectedMenuItemClass : ""}`} type="button" role="menuitemradio" aria-checked={selected} aria-current={selected ? "true" : undefined} onClick={() => select(`navigation-${value}`)}>
                        <span className="flex items-center justify-between gap-3"><span>{label}</span>{selected && <span className="text-[11px] text-[#a9c5ff]" aria-hidden="true">✓</span>}</span>
                    </button>;
                })}
            </div>
        </div>}
    </div>;
}
