import { useEffect, useState } from "react";

/**
 * Ground-station operations own the right-side workspace while they are
 * visible.  Other inspectable panels subscribe to this presentation state so
 * their data remains intact but they do not bleed through the station panel.
 */
export const GROUND_STATIONS_PANEL_STATE_EVENT = "orbit:ground-stations-panel-state";

let groundStationsPanelOpen = false;

export function publishGroundStationsPanelState(open, detail = {}) {
    groundStationsPanelOpen = open === true;
    if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("orbit-ground-stations-panel-open", groundStationsPanelOpen);
    }
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(GROUND_STATIONS_PANEL_STATE_EVENT, {
        detail: {
            open: groundStationsPanelOpen,
            ...detail
        }
    }));
}

export default function useGroundStationsPanelVisibility() {
    const [open, setOpen] = useState(() => groundStationsPanelOpen);

    useEffect(() => {
        const receive = (event) => setOpen(event.detail?.open === true);
        window.addEventListener(GROUND_STATIONS_PANEL_STATE_EVENT, receive);
        return () => window.removeEventListener(GROUND_STATIONS_PANEL_STATE_EVENT, receive);
    }, []);

    return open;
}
