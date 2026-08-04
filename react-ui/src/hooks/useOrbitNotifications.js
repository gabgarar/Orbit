import { useEffect, useState } from "react";

export default function useOrbitNotifications() {
    const [notifications, setNotifications] = useState([]);
    useEffect(() => {
        const sync = (event) => setNotifications(Array.isArray(event.detail) ? event.detail : []);
        window.addEventListener("orbit:notifications", sync);
        return () => window.removeEventListener("orbit:notifications", sync);
    }, []);
    return notifications;
}
