import { useEffect } from "react";
import { markOrbitRuntimeFailed } from "../services/projectRuntime.js";

export default function CesiumGlobe() {
    useEffect(() => {
        import("../runtime/legacyRuntime.js").catch((error) => {
            console.error("Orbit runtime could not be loaded.", error);
            markOrbitRuntimeFailed(error);
            window.dispatchEvent(new CustomEvent("orbit:runtime-failed", {
                detail: error instanceof Error ? error.message : String(error)
            }));
        });
    }, []);

    return <main id="cesiumContainer" aria-label="Visor orbital" />;
}
