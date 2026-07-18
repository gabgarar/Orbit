import { useState } from "react";

export default function CameraControls() {
    const [open, setOpen] = useState(false);
    const send = (type) => window.dispatchEvent(new CustomEvent("orbit:camera-action", { detail: { type } }));
    const select = (type) => { send(type); setOpen(false); };
    return <div className="react-camera-controls"><button type="button" aria-label="Controles de camara" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Camera</button>{open && <div role="menu"><button type="button" role="menuitem" onClick={() => select("reset")}>Restablecer vista</button><button type="button" role="menuitem" onClick={() => select("3d")}>Vista 3D</button><button type="button" role="menuitem" onClick={() => select("2d")}>Vista 2D</button><button type="button" role="menuitem" onClick={() => select("columbus")}>Columbus</button><button type="button" role="menuitem" onClick={() => select("navigation")}>Camara libre/fija</button></div>}</div>;
}
