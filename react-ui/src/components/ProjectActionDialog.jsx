import NewProjectForm from "../features/projects/NewProjectForm.jsx";
import OpenProjectForm from "../features/projects/OpenProjectForm.jsx";
import useProjectActionDialog from "../hooks/useProjectActionDialog.js";

export default function ProjectActionDialog() {
    const { mode, close } = useProjectActionDialog();
    if (!mode) return null;
    return <div id="projectActionModal" className="open" onMouseDown={(event) => event.target === event.currentTarget && close()}>{mode === "new" ? <NewProjectForm onClose={close} /> : <OpenProjectForm onClose={close} />}</div>;
}
