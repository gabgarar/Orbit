import { useRef, useState } from "react";
import { requestProjectCommand } from "../../services/projectRuntime.js";

export default function OpenProjectForm({ onClose }) {
    const fileInput = useRef(null);
    const [openError, setOpenError] = useState("");
    const selectFile = (event) => { const file = event.target.files?.[0]; if (!file) return; const result = requestProjectCommand({ type: "open", file }); event.target.value = ""; if (!result.accepted) { setOpenError("El visor no está disponible. Recarga la aplicación para volver a intentarlo."); return; } onClose(); };
    return <section className="project-action-dialog"><button className="project-action-close" type="button" aria-label="Cerrar" onClick={onClose}>&#215;</button><p className="project-action-eyebrow">ORBIT PROJECT</p><h2>Abrir proyecto</h2><p>Selecciona un archivo de proyecto exportado por Orbit.</p>{openError && <p className="project-action-error" role="alert">{openError}</p>}<input ref={fileInput} id="openProjectFileInput" type="file" accept=".json,application/json" hidden onChange={selectFile} /><button className="project-file-picker" type="button" onClick={() => fileInput.current?.click()}><span>Seleccionar archivo .json</span><small>El proyecto se abrirá en esta sesión.</small></button><div className="project-action-buttons"><button className="secondary" type="button" onClick={onClose}>Cancelar</button></div></section>;
}
