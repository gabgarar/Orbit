import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { reactUiDirectory } from "./runtime-vendor-paths.mjs";

const outputDirectory = path.resolve(reactUiDirectory, "../front/dist");
const blockedCdn = /https?:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)\b/i;
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs"]);

async function requireFile(relativePath) {
    const filePath = path.join(outputDirectory, relativePath);
    await access(filePath);
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size === 0) {
        throw new Error(`Expected generated runtime asset is empty: ${relativePath}`);
    }
}

async function requireDirectory(relativePath) {
    const directoryPath = path.join(outputDirectory, relativePath);
    const metadata = await stat(directoryPath);
    if (!metadata.isDirectory() || (await readdir(directoryPath)).length === 0) {
        throw new Error(`Expected generated runtime directory is empty: ${relativePath}`);
    }
}

async function* textFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* textFiles(filePath);
        } else if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
            yield filePath;
        }
    }
}

await Promise.all([
    requireFile("Cesium/Cesium.js"),
    requireFile("Cesium/Widgets/widgets.css"),
    requireDirectory("Cesium/Assets"),
    requireDirectory("Cesium/Workers"),
    requireFile("vendor/pako.min.js")
]);

for await (const filePath of textFiles(outputDirectory)) {
    const contents = await readFile(filePath, "utf8");
    if (blockedCdn.test(contents)) {
        throw new Error(`CDN reference found in generated frontend asset: ${path.relative(outputDirectory, filePath)}`);
    }
}

