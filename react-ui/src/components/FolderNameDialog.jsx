import { useEffect, useState } from "react";

export default function FolderNameDialog() {
    const [request, setRequest] = useState(null);
    const [value, setValue] = useState("");
    const close = (name = null) => { if (request) window.dispatchEvent(new CustomEvent("orbit:folder-name-response", { detail: { id: request.id, name } })); setRequest(null); };
    useEffect(() => { const open = (event) => { setRequest(event.detail); setValue(event.detail?.initialValue || ""); }; window.addEventListener("orbit:folder-name-request", open); return () => window.removeEventListener("orbit:folder-name-request", open); }, []);
    if (!request) return null;
    return <div id="folderNameModal" className="open" onMouseDown={(event) => event.target === event.currentTarget && close()}><form className="folder-name-dialog" onSubmit={(event) => { event.preventDefault(); if (value.trim()) close(value.trim()); }}><h3>{request.title}</h3><label><span>{request.label}</span><input autoFocus maxLength="80" value={value} onChange={(event) => setValue(event.target.value)} /></label><div><button type="button" onClick={() => close()}>Cancelar</button><button type="submit">Crear carpeta</button></div></form></div>;
}
