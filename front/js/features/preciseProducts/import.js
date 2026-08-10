/**
 * Client-side helpers for importing precise GNSS products.
 *
 * The files are deliberately sent to the Python service unchanged.  SP3/CLK
 * parsing, archive extraction and product validation belong to the backend so
 * that the same rules are applied to a browser upload and a restored project.
 */

export const PRECISE_PRODUCT_FILE_ACCEPT = [
    ".sp3",
    ".sp3c",
    ".sp3d",
    ".clk",
    ".clk_30s",
    ".clk_05s",
    ".sp3.gz",
    ".sp3c.gz",
    ".sp3d.gz",
    ".clk.gz",
    ".clk_30s.gz",
    ".clk_05s.gz",
    ".sp3.zip",
    ".sp3c.zip",
    ".sp3d.zip",
    ".clk.zip",
    ".clk_30s.zip",
    ".clk_05s.zip",
    ".sp3.Z",
    ".sp3c.Z",
    ".sp3d.Z",
    ".clk.Z",
    ".clk_30s.Z",
    ".clk_05s.Z",
    ".gz",
    ".zip",
    ".Z"
].join(",");

export const PRECISE_PRODUCT_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const PRECISE_PRODUCT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const PRECISE_PRODUCT_MAX_FILES = 8;

const ARCHIVE_SUFFIX = "(?:\\.(?:gz|zip|z))?";
// RINEX clock products commonly use `.clk_30s` or `.clk_05s` rather than a
// bare `.clk` suffix. Keep those names paired with their SP3 product before
// handing their content to the backend's stricter archive/parser validation.
const PRODUCT_FILE_PATTERN = new RegExp(`\\.(?:sp3(?:c|d)?|clk(?:_(?:30s|05s))?)${ARCHIVE_SUFFIX}$`, "i");
const ZIP_CONTAINER_PATTERN = /\.zip$/i;

const KNOWN_PROVIDER_HINTS = new Set(["auto", "cddis-igs", "igs-mgex", "esa-nso", "custom"]);
const KNOWN_PRODUCT_CLASSES = new Set(["auto", "final", "rapid", "ultra-rapid"]);

export function isPreciseProductFileName(fileName) {
    const name = String(fileName || "").trim();
    // A generic ZIP is permitted because the backend opens it under a strict
    // member/count/size policy and requires exactly one SP3 plus an optional
    // CLK. Generic .gz/.Z files have no equivalent safe pairing clue, so they
    // must retain their SP3/CLK stem (for example `..._ORB.SP3.gz`).
    return PRODUCT_FILE_PATTERN.test(name) || ZIP_CONTAINER_PATTERN.test(name);
}

export function normalizePreciseProductImportOptions(options = {}) {
    const providerHint = String(options.provider_hint ?? options.providerHint ?? "auto").trim().toLowerCase();
    const productClass = String(options.product_class ?? options.productClass ?? "auto").trim().toLowerCase();
    return {
        provider_hint: KNOWN_PROVIDER_HINTS.has(providerHint) ? providerHint : "auto",
        product_class: KNOWN_PRODUCT_CLASSES.has(productClass) ? productClass : "auto"
    };
}

/**
 * Browser-safe base64 conversion.  Chunking avoids spreading a large
 * Uint8Array into a function call, which otherwise fails for precise products
 * with many megabytes of samples.
 */
export function arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array
        ? buffer
        : new Uint8Array(buffer || new ArrayBuffer(0));
    const chunkSize = 0x8000;
    let binary = "";
    for (let start = 0; start < bytes.length; start += chunkSize) {
        const chunk = bytes.subarray(start, Math.min(start + chunkSize, bytes.length));
        let chunkText = "";
        for (let index = 0; index < chunk.length; index += 1) {
            chunkText += String.fromCharCode(chunk[index]);
        }
        binary += chunkText;
    }
    return btoa(binary);
}

export function validatePreciseProductFiles(files) {
    const selected = Array.from(files || []).filter(Boolean);
    if (!selected.length) {
        throw new Error("Selecciona al menos un SP3 o CLK.");
    }
    if (selected.length > PRECISE_PRODUCT_MAX_FILES) {
        throw new Error(`Se admiten como máximo ${PRECISE_PRODUCT_MAX_FILES} archivos por importación.`);
    }

    let totalBytes = 0;
    for (const file of selected) {
        const name = String(file?.name || "").trim();
        const size = Number(file?.size);
        if (!name || !isPreciseProductFileName(name)) {
            throw new Error(`${name || "El archivo"} no parece un producto SP3/CLK o un contenedor compatible.`);
        }
        if (!Number.isFinite(size) || size < 0) {
            throw new Error(`No se pudo determinar el tamaño de ${name}.`);
        }
        if (size > PRECISE_PRODUCT_MAX_FILE_BYTES) {
            throw new Error(`${name} supera el máximo de 32 MiB por archivo.`);
        }
        totalBytes += size;
    }
    if (totalBytes > PRECISE_PRODUCT_MAX_TOTAL_BYTES) {
        throw new Error("Los archivos superan el máximo total de 64 MiB antes de descomprimir.");
    }
    return selected;
}

export async function buildPreciseProductImportPayload(files, options = {}) {
    const selected = validatePreciseProductFiles(files);
    const encodedFiles = await Promise.all(selected.map(async (file) => ({
        name: String(file.name || "").trim(),
        content_base64: arrayBufferToBase64(await file.arrayBuffer())
    })));
    return {
        files: encodedFiles,
        ...normalizePreciseProductImportOptions(options)
    };
}
