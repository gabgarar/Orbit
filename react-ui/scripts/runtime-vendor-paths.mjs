import path from "node:path";
import { fileURLToPath } from "node:url";

export const reactUiDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const runtimeVendorDirectory = path.join(reactUiDirectory, ".runtime-vendor");
export const cesiumVendorDirectory = path.join(runtimeVendorDirectory, "Cesium");
export const pakoVendorFile = path.join(runtimeVendorDirectory, "vendor", "pako.min.js");

