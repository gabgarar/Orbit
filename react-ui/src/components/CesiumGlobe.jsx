import { useEffect } from "react";

export default function CesiumGlobe() {
    useEffect(() => {
        const legacyEntry = "/main.js";
        import(/* @vite-ignore */ legacyEntry).catch((error) => console.error("Orbit runtime could not be loaded.", error));
    }, []);

    return <main id="cesiumContainer" aria-label="Visor orbital" />;
}
