import { useEffect, useRef, useState } from "react";
import { requestProjectCommand } from "../../services/projectRuntime.js";

export default function NewProjectForm({ onClose }) {
    const [projectName, setProjectName] = useState("Untitled project"); const [submitError, setSubmitError] = useState(""); const nameInput = useRef(null);
    useEffect(() => { nameInput.current?.focus(); nameInput.current?.select(); }, []);
    const submit = (event) => { event.preventDefault(); const name = projectName.trim(); if (!name) return; const result = requestProjectCommand({ type: "new", name }); if (!result.accepted) { setSubmitError("El visor no está disponible. Recarga la aplicación para volver a intentarlo."); return; } onClose(); };
    return <form className="project-action-dialog" onSubmit={submit}><button className="project-action-close" type="button" aria-label="Cerrar" onClick={onClose}>&#215;</button><p className="project-action-eyebrow">ORBIT PROJECT</p><h2>Nuevo proyecto</h2><p>Define un nombre para comenzar un proyecto vacío.</p>{submitError && <p className="project-action-error" role="alert">{submitError}</p>}<label>Nombre del proyecto<input ref={nameInput} type="text" maxLength="80" required autoComplete="off" value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><div className="project-action-buttons"><button className="secondary" type="button" onClick={onClose}>Cancelar</button><button className="primary" type="submit">Crear proyecto</button></div></form>;
}
