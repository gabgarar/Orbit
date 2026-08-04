import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOrbitRuntime } from "./src/runtime/orbit-runtime.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const runtime = createOrbitRuntime({ serverDir });

await runtime.start();
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
        await runtime.stop(signal);
        process.exit(0);
    });
}
