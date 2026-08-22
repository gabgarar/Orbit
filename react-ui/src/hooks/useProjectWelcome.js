import { useCallback, useEffect, useState } from "react";
import { getOrbitRuntimeStatus, ORBIT_RUNTIME_STATUS_EVENT } from "../services/projectRuntime.js";

export default function useProjectWelcome() {
    const [isOpen, setIsOpen] = useState(true);
    const [runtimeStatus, setRuntimeStatus] = useState(() => getOrbitRuntimeStatus());
    const dismiss = useCallback(() => setIsOpen(false), []);
    const open = useCallback(() => setIsOpen(true), []);
    useEffect(() => {
        const updateRuntimeStatus = (event) => setRuntimeStatus(event.detail || getOrbitRuntimeStatus());
        window.addEventListener("orbit:project-opened", dismiss);
        window.addEventListener(ORBIT_RUNTIME_STATUS_EVENT, updateRuntimeStatus);
        updateRuntimeStatus({});
        return () => {
            window.removeEventListener("orbit:project-opened", dismiss);
            window.removeEventListener(ORBIT_RUNTIME_STATUS_EVENT, updateRuntimeStatus);
        };
    }, []);
    return { isOpen, runtimeStatus, open, dismiss };
}
