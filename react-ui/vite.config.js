import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { access, copyFile, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import {
    cesiumVendorDirectory,
    pakoVendorFile,
    reactUiDirectory
} from "./scripts/runtime-vendor-paths.mjs";

const outputDirectory = path.resolve(reactUiDirectory, "../front/dist");

async function requireBuildAsset(source, label) {
    try {
        await access(source);
    } catch {
        throw new Error(`${label} is missing. Run npm run vendor:runtime before building Orbit.`);
    }
}

function copyLocalRuntimeAssets() {
    return {
        name: "orbit-copy-local-runtime-assets",
        async closeBundle() {
            await Promise.all([
                requireBuildAsset(path.join(cesiumVendorDirectory, "Cesium.js"), "Cesium Build/Cesium"),
                requireBuildAsset(pakoVendorFile, "pako dist/pako.min.js")
            ]);
            await Promise.all([
                cp(cesiumVendorDirectory, path.join(outputDirectory, "Cesium"), {
                    recursive: true,
                    force: true
                }),
                mkdir(path.join(outputDirectory, "vendor"), { recursive: true })
            ]);
            await copyFile(pakoVendorFile, path.join(outputDirectory, "vendor", "pako.min.js"));
        }
    };
}

export default defineConfig({
    plugins: [react(), tailwindcss(), copyLocalRuntimeAssets()],
    // The vendor script runs before both `vite` and `vite build`. Exposing the
    // same directory here keeps /Cesium and /vendor available in development,
    // while the plugin above verifies and copies them into the final bundle.
    publicDir: ".runtime-vendor",
    build: {
        outDir: "../front/dist",
        emptyOutDir: true
    }
});
