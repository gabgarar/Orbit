import NewProjectForm from "../features/projects/NewProjectForm.jsx";
import OpenProjectForm from "../features/projects/OpenProjectForm.jsx";
import useProjectActionDialog from "../hooks/useProjectActionDialog.js";

export default function ProjectActionDialog() {
    const { mode, close, startupReadiness } = useProjectActionDialog();
    if (!mode) return null;

    return <div
        id="projectActionModal"
        className="open !fixed !inset-0 !z-[10600] !grid !place-items-center !bg-[#020710b3] !p-5 !backdrop-blur-md"
        onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
        {mode === "new" ? <NewProjectForm onClose={close} startupReadiness={startupReadiness} /> : <OpenProjectForm onClose={close} startupReadiness={startupReadiness} />}
    </div>;
}
