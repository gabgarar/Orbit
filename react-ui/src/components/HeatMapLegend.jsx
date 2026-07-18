import { useEffect, useState } from "react";

export default function HeatMapLegend() {
    const [visible, setVisible] = useState(false);
    useEffect(() => { const update = (event) => setVisible(event.detail === true); window.addEventListener("orbit:heat-legend", update); return () => window.removeEventListener("orbit:heat-legend", update); }, []);
    if (!visible) return null;
    return <aside id="groundStationHeatLegend" className="visible" aria-label="Leyenda de cobertura heat map"><div className="heat-legend-title">Heat map cobertura</div><div className="heat-legend-bar" aria-hidden="true" /><div className="heat-legend-ticks"><span>0%</span><span>30%</span><span>55%</span><span>80%</span><span>100%</span></div></aside>;
}
