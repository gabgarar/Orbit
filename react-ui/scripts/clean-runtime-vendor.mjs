import { rm } from "node:fs/promises";
import { runtimeVendorDirectory } from "./runtime-vendor-paths.mjs";

await rm(runtimeVendorDirectory, { recursive: true, force: true });

