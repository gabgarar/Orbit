import { useEffect, useState } from "react";
import { buildObjectDetails } from "../features/objectDetails/detailRows.js";
import useSelectedObject from "../hooks/useSelectedObject.js";

const tabs = [["overview", "OVERVIEW"], ["orbit", "ORBIT"], ["telemetry", "TELEMETRY"], ["info", "INFO"]];
function DetailRows({ rows }) { return <div className="object-details-rows">{rows.map(([label, data, tone]) => <div className="object-details-row" key={label}><span>{label}</span><strong className={tone || ""}>{data}</strong></div>)}</div>; }

export default function ObjectDetailsPanel() {
    const detail = useSelectedObject(); const [tab, setTab] = useState("overview"); const [dismissedId, setDismissedId] = useState(null);
    useEffect(() => { if (detail?.id && detail.id !== dismissedId) setDismissedId(null); }, [detail?.id, dismissedId]);
    if (!detail || dismissedId === detail.id) return null;
    const details = buildObjectDetails(detail);
    return <aside className="object-details-panel" aria-label="Detalles del objeto seleccionado"><button className="object-details-close" type="button" aria-label="Cerrar detalles" onClick={() => setDismissedId(detail.id)}>&#215;</button><h2>{details.title}</h2><div className="object-details-meta"><span className={details.visible ? "object-status active" : "object-status hidden"}>{details.visible ? "ACTIVE" : "HIDDEN"}</span><span>NORAD {details.noradId}</span></div><nav className="object-details-tabs" aria-label="Secciones de detalle">{tabs.map(([key, label]) => <button className={tab === key ? "active" : ""} type="button" key={key} onClick={() => setTab(key)}>{label}</button>)}</nav><DetailRows rows={details.rows[tab]} /><button className="object-details-full" type="button">View full details <span aria-hidden="true">&#8599;</span></button></aside>;
}
