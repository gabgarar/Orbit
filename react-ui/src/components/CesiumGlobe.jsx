import { useEffect } from "react";
import { markOrbitRuntimeFailed } from "../services/projectRuntime.js";

export default function CesiumGlobe() {
    useEffect(() => {
        import("../runtime/legacyRuntime.js").catch((error) => {
            console.error("Orbit runtime could not be loaded.", error);
            markOrbitRuntimeFailed(error);
        });
    }, []);

    return <main id="cesiumContainer" aria-label="Visor orbital" />;
}
