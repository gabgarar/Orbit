/**
 * Browser-side contract for an imported GNSS precise product.
 *
 * The browser never parses or transforms a precise product.  It only keeps
 * the logical product members separate enough for the Python service to
 * validate and persist their provenance.  Provider and product class are
 * deliberately derived by the service from the files themselves: importing a
 * precise product must not let an operator rewrite its provenance.
 */

export const PRECISE_PRODUCT_IMPORT_ERRORS = Object.freeze({
    missingSp3: "Debe proporcionar un fichero SP3.",
    // Retained for the future ECI comparison capability guard.  The GNSS
    // import dialog intentionally does not expose or request that operation.
    missingErpForEci: "Debe proporcionar un fichero ERP para convertir a ECI."
});

export const PRECISE_PRODUCT_FILE_SLOTS = Object.freeze([
    {
        kind: "sp3",
        label: "SP3 · órbitas precisas",
        description: "Obligatorio. Contiene las efemérides precisas.",
        accept: ".sp3,.sp3.gz",
        // Chromium on Windows does not consistently expose compound
        // extensions in its native picker.  The broader picker filter is
        // advisory only; `classifyPreciseProductSlotFile` still validates the
        // complete filename before the file can enter this slot.
        pickerAccept: ".sp3,.sp3.gz,.gz",
        required: true
    },
    {
        kind: "clk",
        label: "CLK · relojes precisos",
        description: "Opcional. Correcciones de reloj asociadas al producto.",
        accept: ".clk,.clk.gz",
        pickerAccept: ".clk,.clk.gz,.gz"
    },
    {
        kind: "erp",
        label: "ERP · parámetros de rotación terrestre",
        description: "Opcional. Aporta los parámetros de orientación terrestre del producto.",
        accept: ".erp,.erp.gz",
        pickerAccept: ".erp,.erp.gz,.gz"
    },
    {
        kind: "sum",
        label: "SUM · metadatos del producto",
        description: "Opcional. Resumen y metadatos publicados por el proveedor.",
        accept: ".sum,.sum.gz",
        pickerAccept: ".sum,.sum.gz,.gz"
    },
    {
        kind: "att",
        label: "ATT / OBX · actitud satelital",
        description: "Opcional. Producto de actitud ATT.OBX; también admite ficheros OBX o ATT del proveedor.",
        accept: ".att.obx,.att.obx.gz,.obx,.obx.gz,.att,.att.gz",
        pickerAccept: ".att.obx,.att.obx.gz,.obx,.obx.gz,.att,.att.gz,.gz"
    },
    {
        kind: "osb",
        label: "OSB / BIA · sesgos por observable",
        description: "Opcional. Sesgos OSB.BIA; también admite ficheros BIA del proveedor.",
        accept: ".osb.bia,.osb.bia.gz,.bia,.bia.gz",
        pickerAccept: ".osb.bia,.osb.bia.gz,.bia,.bia.gz,.gz"
    }
]);

const SLOT_BY_KIND = new Map(PRECISE_PRODUCT_FILE_SLOTS.map((slot) => [slot.kind, slot]));
const FILE_ACCEPT_VALUES = new Set(PRECISE_PRODUCT_FILE_SLOTS
    .flatMap((slot) => slot.accept.split(",")));

// The named fields deliberately implement the small, documented contract
// above. The older drop/multi-file flow remains broader so existing SP3c/d,
// RINEX CLK variants and bounded SP3/CLK archives do not regress.
const LEGACY_PRODUCT_ACCEPT_VALUES = [
    ".sp3c", ".sp3c.gz", ".sp3d", ".sp3d.gz",
    ".sp3.zip", ".sp3c.zip", ".sp3d.zip",
    ".sp3.Z", ".sp3c.Z", ".sp3d.Z",
    ".clk_30s", ".clk_30s.gz", ".clk_05s", ".clk_05s.gz",
    ".clk.zip", ".clk_30s.zip", ".clk_05s.zip",
    ".clk.Z", ".clk_30s.Z", ".clk_05s.Z",
    ".zip"
];
for (const value of LEGACY_PRODUCT_ACCEPT_VALUES) FILE_ACCEPT_VALUES.add(value);
export const PRECISE_PRODUCT_FILE_ACCEPT = [...FILE_ACCEPT_VALUES].join(",");

export const PRECISE_PRODUCT_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const PRECISE_PRODUCT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const PRECISE_PRODUCT_MAX_FILES = 8;

const ARCHIVE_SUFFIX = "(?:\\.(?:gz|zip|z))?";
const SLOT_PATTERNS = Object.freeze({
    sp3: /\.sp3(?:\.gz)?$/i,
    clk: /\.clk(?:\.gz)?$/i,
    erp: /\.erp(?:\.gz)?$/i,
    sum: /\.sum(?:\.gz)?$/i,
    // Official IGS products use ATT.OBX and OSB.BIA.  Some providers expose
    // the terminal product extension only, so accept those practical forms in
    // the corresponding explicit slot too.  The semantic slot still prevents
    // an OBX file from being mistaken for an OSB product (or vice versa).
    att: /(?:\.att\.obx|\.obx|\.att)(?:\.gz)?$/i,
    osb: /(?:\.osb\.bia|\.bia)(?:\.gz)?$/i
});
const LEGACY_SLOT_PATTERNS = Object.freeze({
    sp3: new RegExp(`\\.sp3(?:c|d)?${ARCHIVE_SUFFIX}$`, "i"),
    clk: new RegExp(`\\.clk(?:_(?:30s|05s))?${ARCHIVE_SUFFIX}$`, "i")
});
const ZIP_CONTAINER_PATTERN = /\.zip$/i;

function text(value) {
    return String(value ?? "").trim();
}

function fileFromSelection(selection) {
    if (selection && typeof selection === "object" && selection.file) return selection.file;
    return selection;
}

function requestedKind(selection) {
    if (!selection || typeof selection !== "object") return "";
    const value = text(selection.kind ?? selection.slot ?? selection.file_kind ?? selection.fileKind).toLowerCase();
    return SLOT_BY_KIND.has(value) || value === "archive" ? value : "";
}

/**
 * Return the logical GNSS product member represented by a file name.
 *
 * Named dialog slots use the canonical documented suffixes. Generic legacy
 * import/drop callers keep their established SP3c/d and RINEX CLK variants.
 */
export function classifyPreciseProductFile(fileName, { allowLegacy = true } = {}) {
    const name = text(fileName);
    for (const [kind, pattern] of Object.entries(SLOT_PATTERNS)) {
        if (pattern.test(name)) return kind;
    }
    if (allowLegacy) {
        for (const [kind, pattern] of Object.entries(LEGACY_SLOT_PATTERNS)) {
            if (pattern.test(name)) return kind;
        }
    }
    // A generic .zip may contain the historical SP3/CLK pair. Keep this
    // compatibility path; the service remains the authority that inspects it.
    return ZIP_CONTAINER_PATTERN.test(name) ? "archive" : "";
}

/** Classify a file selected in one of the six canonical GNSS dialog slots. */
export function classifyPreciseProductSlotFile(fileName) {
    return classifyPreciseProductFile(fileName, { allowLegacy: false });
}

/**
 * Normalize browser File values and slot-owned wrappers into logical product
 * entries.  A requested slot may only override an opaque archive: direct
 * product suffixes always determine their own type.
 */
export function normalizePreciseProductFileSelections(files) {
    return Array.from(files || []).filter(Boolean).map((selection) => {
        const file = fileFromSelection(selection);
        const detectedKind = classifyPreciseProductFile(file?.name);
        const kind = detectedKind === "archive" ? (requestedKind(selection) || "archive") : detectedKind;
        return { file, kind };
    });
}

export function isPreciseProductFileName(fileName) {
    return Boolean(classifyPreciseProductFile(fileName));
}

export function preciseProductSlotForKind(kind) {
    return SLOT_BY_KIND.get(text(kind).toLowerCase()) || null;
}

/**
 * Validate only browser-known invariants. Product decoding, archive safety and
 * ERP parsing deliberately remain in the Python service.
 */
export function validatePreciseProductFiles(files) {
    const selections = normalizePreciseProductFileSelections(files);
    if (selections.length > PRECISE_PRODUCT_MAX_FILES) {
        throw new Error(`Se admiten como máximo ${PRECISE_PRODUCT_MAX_FILES} archivos por importación.`);
    }

    const seenSlots = new Set();
    let hasSp3 = false;
    let totalBytes = 0;
    for (const { file, kind } of selections) {
        const name = text(file?.name);
        const size = Number(file?.size);
        if (!name || !kind) {
            throw new Error(`${name || "El archivo"} no parece un producto GNSS compatible.`);
        }
        if (kind !== "archive") {
            if (seenSlots.has(kind)) {
                throw new Error(`Solo se puede proporcionar un fichero ${kind.toUpperCase()}.`);
            }
            seenSlots.add(kind);
        }
        if (!Number.isFinite(size) || size < 0) {
            throw new Error(`No se pudo determinar el tamaño de ${name}.`);
        }
        if (size > PRECISE_PRODUCT_MAX_FILE_BYTES) {
            throw new Error(`${name} supera el máximo de 32 MiB por archivo.`);
        }
        totalBytes += size;
        hasSp3 ||= kind === "sp3" || kind === "archive";
    }
    if (!hasSp3) {
        throw new Error(PRECISE_PRODUCT_IMPORT_ERRORS.missingSp3);
    }
    if (totalBytes > PRECISE_PRODUCT_MAX_TOTAL_BYTES) {
        throw new Error("Los archivos superan el máximo total de 64 MiB antes de descomprimir.");
    }
    return selections.map(({ file }) => file);
}

/** Browser-safe base64 conversion without spreading a multi-MiB Uint8Array. */
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

/** Build typed companion slots without duplicating upload bytes.
 *
 * Provenance, class and frame capabilities are determined server-side from
 * the uploaded data.  Importing does not request an ECI conversion; a future
 * comparison tool will ask for that capability at the time it needs it. The
 * legacy `files` transport is emitted only for legacy/archive selections;
 * sending modern files both there and in named slots doubles large ATT/CLK
 * uploads and can make an otherwise valid product appear unresponsive.
 */
export async function buildPreciseProductImportPayload(files) {
    validatePreciseProductFiles(files);
    const selected = normalizePreciseProductFileSelections(files);
    const encodedFiles = await Promise.all(selected.map(async ({ file, kind }) => ({
        name: text(file?.name),
        kind,
        content_base64: arrayBufferToBase64(await file.arrayBuffer())
    })));
    // Do not reflect a legacy SP3c/d or CLK variant into a canonical named
    // slot. The backend deliberately applies the narrow suffix contract to
    // named fields, while `files` remains the backwards-compatible transport.
    const namedSlots = Object.fromEntries(PRECISE_PRODUCT_FILE_SLOTS
        .map(({ kind }) => [kind, encodedFiles.find((file) => (
            file.kind === kind && classifyPreciseProductSlotFile(file.name) === kind
        ))])
        .filter(([, file]) => Boolean(file)));
    const legacyFiles = encodedFiles.filter((file) => !(
        file.kind !== "archive"
        && classifyPreciseProductSlotFile(file.name) === file.kind
    ));
    return {
        ...namedSlots,
        ...(legacyFiles.length ? { files: legacyFiles } : {})
    };
}
