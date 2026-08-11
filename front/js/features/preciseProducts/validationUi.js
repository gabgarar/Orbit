/**
 * Presentation contract for safety checks performed by the precise-product
 * service.
 *
 * The parser remains the authority for every scientific validation.  This
 * module only gives the UI a stable, testable way to explain a rejected
 * operation and to render a concise success summary returned by that parser.
 */

export const PRECISE_PRODUCT_VALIDATION_DIALOG_EVENT = "orbit:precise-product-validation-dialog";
export const PRECISE_PRODUCT_VALIDATION_DIALOG_DISMISS_EVENT = "orbit:precise-product-validation-dialog-dismiss";

function text(value) {
    return String(value ?? "").trim();
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function formatCount(value, singular, plural = `${singular}s`) {
    const count = nonNegativeInteger(value);
    if (count === null) return "";
    return `${count.toLocaleString("es-ES")} ${count === 1 ? singular : plural}`;
}

function formatMetres(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return "";
    if (number === 0) return "0 m";
    if (number < 0.001) return `${number.toExponential(2)} m`;
    return `${number.toLocaleString("es-ES", { maximumFractionDigits: 6 })} m`;
}

/**
 * Extract the structural-validation report from either preview or import
 * payloads.  Older services simply omit this field, which must not make a
 * valid product look invalid in the browser.
 */
export function preciseProductValidationReport(payload = {}) {
    const root = record(payload) || {};
    const preview = record(root.preview) || {};
    const product = record(root.product) || record(preview.product) || {};
    return record(
        product.sp3_validation
        ?? product.sp3Validation
        ?? root.sp3_validation
        ?? root.sp3Validation
    );
}

/**
 * Convert a passed backend report into short facts appropriate for the
 * satellite-selection screen.  The facts are deliberately source-backed:
 * absent fields are simply not displayed.
 */
export function summarizePreciseProductValidation(payload = {}) {
    const report = preciseProductValidationReport(payload);
    if (text(report?.status).toLowerCase() !== "passed") return null;

    const header = record(report.header) || {};
    const epochs = record(report.epochs) || {};
    const positions = record(report.positions) || {};
    const interpolation = record(report.interpolation) || {};
    const facts = [];

    const satellites = formatCount(header.satellite_count, "satélite", "satélites");
    const epochCount = formatCount(epochs.count ?? header.epoch_count, "época", "épocas");
    if (satellites || epochCount) {
        facts.push([satellites, epochCount].filter(Boolean).join(" · "));
    }

    const cadence = positiveNumber(epochs.cadence_seconds ?? epochs.header_cadence_seconds);
    if (cadence !== null) {
        facts.push(`cadencia constante de ${cadence.toLocaleString("es-ES", { maximumFractionDigits: 6 })} s`);
    }

    const usableRecords = formatCount(positions.usable_records, "posición utilizable", "posiciones utilizables");
    if (usableRecords) facts.push(usableRecords);

    const method = text(interpolation.method).toUpperCase();
    const maxDegree = nonNegativeInteger(interpolation.max_degree);
    const maxKnotError = formatMetres(interpolation.max_knot_error_m);
    if (method || maxDegree !== null || maxKnotError) {
        const methodLabel = method || "interpolación";
        const degreeLabel = maxDegree !== null ? `grado ≤ ${maxDegree}` : "";
        const errorLabel = maxKnotError ? `error en nudos ${maxKnotError}` : "";
        facts.push([methodLabel, degreeLabel, errorLabel].filter(Boolean).join(" · "));
    }

    return {
        title: "Validación estructural SP3 superada",
        facts,
        message: facts.length
            ? `SP3 validado: ${facts.join("; ")}.`
            : "SP3 validado correctamente por el servicio local."
    };
}

function errorMessage(error) {
    if (error instanceof Error) return text(error.message);
    if (record(error)) return text(error.detail ?? error.error ?? error.message);
    return text(error);
}

/**
 * Create the accessible error-dialog payload used after a local preflight or
 * a 422 service validation failure.  Keeping this payload serialisable lets
 * the legacy importer and the React dialog evolve independently.
 */
export function createPreciseProductValidationFailure(error, {
    phase = "preview",
    focusId = "preciseProductImportConfirmBtn"
} = {}) {
    const importPhase = phase === "import";
    const message = errorMessage(error) || "La validación del producto GNSS no se pudo completar.";
    return {
        id: `precise-product-validation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: importPhase ? "Importación bloqueada por validación" : "Previsualización bloqueada por validación",
        message,
        details: [
            importPhase
                ? "No se ha importado ningún satélite ni se ha guardado el producto."
                : "No se han creado capas ni se ha guardado el producto.",
            "Corrige el fichero indicado y vuelve a ejecutar la validación."
        ],
        acknowledgeLabel: "Revisar archivos",
        focusId
    };
}
