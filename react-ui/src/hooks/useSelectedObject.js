import { useEffect, useState } from "react";

export default function useSelectedObject() {
    const [detail, setDetail] = useState(null);
    useEffect(() => { const onSelection = (event) => setDetail(event.detail || null); window.addEventListener("orbit:selected-object", onSelection); return () => window.removeEventListener("orbit:selected-object", onSelection); }, []);
    return detail;
}
