const SOURCE_TYPES = new Set([
    "tle", "omm", "sp3", "oem", "state-vector", "numeric", "manual", "unknown"
]);

const CARTESIAN_COLUMNS = Object.freeze([
    ["x", "X", "position"],
    ["y", "Y", "position"],
    ["z", "Z", "position"],
    ["vx", "Vx", "velocity"],
    ["vy", "Vy", "velocity"],
    ["vz", "Vz", "velocity"]
]);

const DERIVED_COLUMNS = Object.freeze([
    ["semiMajorAxisKm", "Semieje mayor", "km", ["semi_major_axis_km", "semiMajorAxisKm"]],
    ["eccentricity", "Excentricidad", "", ["eccentricity"]],
    ["inclinationDeg", "Inclinación", "deg", ["inclination_deg", "inclinationDeg"]],
    ["raanDeg", "RAAN", "deg", ["raan_deg", "raanDeg"]],
    ["argumentOfPerigeeDeg", "Argumento de periapsis", "deg", ["argument_of_perigee_deg", "argumentOfPerigeeDeg", "argument_of_periapsis_deg", "argumentOfPeriapsisDeg"]],
    ["trueAnomalyDeg", "Anomalía verdadera", "deg", ["true_anomaly_deg", "trueAnomalyDeg"]],
    ["meanAnomalyDeg", "Anomalía media", "deg", ["mean_anomaly_deg", "meanAnomalyDeg"]],
    ["perigeeAltitudeKm", "Altitud de perigeo", "km", ["perigee_altitude_km", "perigeeAltitudeKm"]],
    ["apogeeAltitudeKm", "Altitud de apogeo", "km", ["apogee_altitude_km", "apogeeAltitudeKm"]],
    ["orbitalPeriodSeconds", "Periodo orbital", "s", ["orbital_period_seconds", "orbitalPeriodSeconds"]],
    ["meanMotionRevDay", "Movimiento medio", "rev/d", ["mean_motion_rev_day", "meanMotionRevDay"]],
    ["radiusKm", "Radio", "km", ["radius_km", "radiusKm"]],
    ["speedKmS", "Velocidad", "km/s", ["speed_km_s", "speedKmS"]]
]);

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function firstValue(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
}

function firstText(...values) {
    for (const value of values) {
        const candidate = text(value);
        if (candidate) return candidate;
    }
    return null;
}

function finiteNumber(value) {
    if (value === undefined || value === null || typeof value === "boolean") return null;
    if (typeof value === "string" && !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function bool(value) {
    return typeof value === "boolean" ? value : null;
}

function aliases(source, keys) {
    const value = record(source);
    for (const key of keys) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key];
    }
    return null;
}

function normalizedToken(value) {
    return text(value).toLowerCase().replace(/[ _/]+/g, "-");
}

function normalizeFormat(value) {
    const token = normalizedToken(value).toUpperCase();
    if (["TLE", "OMM", "SP3", "OEM", "MANUAL", "STATE-VECTOR", "NUMERIC"].includes(token)) return token;
    return token || null;
}

function normalizeDefinitionSource(value) {
    const token = normalizedToken(value);
    return ["state", "state-vector", "statevector"].includes(token) ? "state-vector" : "keplerian";
}

function isNumericMethod(value) {
    const token = normalizedToken(value);
    return token.includes("cowell")
        || token.includes("rk4")
        || token.includes("numer")
        || token === "j2-j3-j4";
}

function sourceTypeFor({ format, manual, definitionSource, methodId }) {
    // Keep MANUAL as the transport format, while exposing its authored
    // state-vector/numerical profile to the inspector.
    if (manual) {
        if (definitionSource === "state-vector") return "state-vector";
        if (isNumericMethod(methodId)) return "numeric";
        return "manual";
    }
    const explicit = normalizedToken(format);
    if (["tle", "omm", "sp3", "oem", "state-vector", "numeric", "manual"].includes(explicit)) {
        return explicit;
    }
    return "unknown";
}

function sourceMetadata(context, result, source) {
    const catalog = record(context.catalogMeta);
    const input = record(firstValue(catalog.inputMetadata, catalog.input_metadata, catalog.sourceMetadata, catalog.source_metadata));
    const manual = record(context.manualOrbit);
    const telemetry = record(context.telemetry);
    // Precise-product layers carry their durable source facts in telemetry.
    // Do not make the inspector dependent on a flattened catalog mirror: a
    // layer can have been restored from a project before that mirror exists.
    const preciseProduct = record(firstValue(
        telemetry.sp3,
        telemetry.preciseProduct,
        telemetry.precise_product,
        catalog.sp3,
        catalog.preciseProduct,
        catalog.precise_product
    ));
    const responseSource = record(result.source);
    const metadata = {
        provider: firstText(
            aliases(responseSource, ["provider", "provider_id", "providerId", "agency", "originator"]),
            aliases(telemetry, ["provider", "provider_label", "providerLabel", "provider_id", "providerId", "agency"]),
            aliases(preciseProduct, ["provider", "provider_label", "providerLabel", "provider_id", "providerId", "agency", "analysis_center", "analysisCenter"]),
            aliases(input, ["provider", "source_provider", "sourceProvider", "agency", "originator"]),
            aliases(catalog, ["provider", "provider_label", "providerLabel", "provider_id", "providerId", "tleSource", "sourceProvider", "source_provider"])
        ),
        objectId: firstText(
            aliases(responseSource, ["sat_id", "satId", "runtime_id", "runtimeId"]),
            aliases(catalog, ["objectId", "object_id", "catalogId", "catalog_id"]),
            context.sourceId
        ),
        epoch: firstText(
            aliases(input, ["epoch", "epoch_utc", "epochUtc"]),
            aliases(catalog, ["epoch", "epoch_utc", "epochUtc"]),
            aliases(manual, ["epochUtc", "epoch_utc", "epoch"])
        ),
        updatedAt: firstText(
            aliases(telemetry, ["updated_at", "updatedAt", "creation_time", "creationTime"]),
            aliases(preciseProduct, ["updated_at", "updatedAt", "creation_time", "creationTime"]),
            aliases(input, ["updated_at", "updatedAt", "creation_time", "creationTime"]),
            aliases(catalog, ["updatedAt", "updated_at", "importedAt", "imported_at"])
        ),
        productId: firstText(
            aliases(responseSource, ["product_id", "productId"]),
            aliases(telemetry, ["product_id", "productId"]),
            aliases(catalog, ["product_id", "productId"]),
            aliases(input, ["product_id", "productId"])
        ),
        productClass: firstText(
            aliases(telemetry, ["product_class", "productClass"]),
            aliases(catalog, ["product_class", "productClass"]),
            aliases(preciseProduct, ["product_class", "productClass"]),
            aliases(input, ["product_class", "productClass"])
        ),
        productFamily: firstText(
            aliases(telemetry, ["product_family", "productFamily"]),
            aliases(catalog, ["product_family", "productFamily"]),
            aliases(preciseProduct, ["product_family", "productFamily"]),
            aliases(input, ["product_family", "productFamily"])
        ),
        coverageStart: firstText(
            aliases(telemetry, ["coverage_start", "coverageStart", "start_time", "startTime"]),
            aliases(preciseProduct, ["coverage_start", "coverageStart", "start_time", "startTime"]),
            aliases(input, ["coverage_start", "coverageStart", "start_time", "startTime"])
        ),
        coverageEnd: firstText(
            aliases(telemetry, ["coverage_end", "coverageEnd", "end_time", "endTime"]),
            aliases(preciseProduct, ["coverage_end", "coverageEnd", "end_time", "endTime"]),
            aliases(input, ["coverage_end", "coverageEnd", "end_time", "endTime"])
        ),
        definitionSource: source.type === "state-vector" ? "state-vector" : (source.kind === "manual" ? "keplerian" : null),
        nativeReferenceFrame: firstText(
            aliases(telemetry, ["native_reference_frame", "nativeReferenceFrame", "native_frame", "nativeFrame"]),
            aliases(preciseProduct, ["reference_frame", "referenceFrame", "native_reference_frame", "nativeReferenceFrame", "native_frame", "nativeFrame"]),
            aliases(input, ["native_reference_frame", "nativeReferenceFrame", "native_frame", "nativeFrame"]),
            aliases(responseSource, ["reference_frame", "referenceFrame"])
        ),
        clock: Object.keys(record(preciseProduct.clock)).length ? preciseProduct.clock : null
    };
    // An OMM may be executed through SGP4 in Orbit, but its mean-element
    // input remains valuable provenance. Keep only explicitly supplied fields
    // (including the usual CCSDS upper-case spellings); do not derive missing
    // values or confuse them with the osculating series returned by SGP4.
    const ommInput = source.type === "omm" ? {
        mean_semi_major_axis_km: firstValue(
            aliases(input, ["mean_semi_major_axis_km", "meanSemiMajorAxisKm", "semi_major_axis_km", "semiMajorAxisKm", "SEMIMAJOR_AXIS", "SEMI_MAJOR_AXIS"]),
            aliases(catalog, ["mean_semi_major_axis_km", "meanSemiMajorAxisKm"])
        ),
        mean_eccentricity: firstValue(aliases(input, ["mean_eccentricity", "meanEccentricity", "ECCENTRICITY"])),
        mean_inclination_deg: firstValue(aliases(input, ["mean_inclination_deg", "meanInclinationDeg", "INCLINATION"])),
        mean_raan_deg: firstValue(aliases(input, ["mean_raan_deg", "meanRaanDeg", "RA_OF_ASC_NODE", "raan_deg", "raanDeg"])),
        mean_argument_of_periapsis_deg: firstValue(aliases(input, ["mean_argument_of_periapsis_deg", "meanArgumentOfPeriapsisDeg", "ARG_OF_PERICENTER", "ARG_OF_PERIGEE"])),
        mean_anomaly_deg_input: firstValue(aliases(input, ["mean_anomaly_deg_input", "meanAnomalyDegInput", "MEAN_ANOMALY", "mean_anomaly_deg", "meanAnomalyDeg"])),
        mean_motion_rev_day: firstValue(aliases(input, ["mean_motion_rev_day", "meanMotionRevDay", "MEAN_MOTION"])),
        bstar: firstValue(aliases(input, ["bstar", "b_star", "bStar", "BSTAR"])),
        solar_radiation_pressure: firstValue(aliases(input, ["solar_radiation_pressure", "solarRadiationPressure", "SRP", "CR_AREA_OVER_MASS"])),
        drag_coefficient: firstValue(aliases(input, ["drag_coefficient", "dragCoefficient", "CD_AREA_OVER_MASS"]))
    } : {};
    return Object.fromEntries([
        ...Object.entries(metadata),
        ...Object.entries(ommInput)
    ].filter(([, value]) => value !== null));
}

/**
 * Normalize the provenance of an inspector request without reclassifying a
 * finite product as a TLE merely because another subsystem happens to have a
 * catalogue identifier for it.
 */
export function normalizePropagatedParametersSource(context = {}, result = {}) {
    const catalog = record(context.catalogMeta);
    const responseSource = record(result.source);
    const manual = record(context.manualOrbit);
    const model = record(result.model);
    const methodId = firstText(model.id, model.applied_engine, context.propagator, manual.propagator);
    const declaredFormat = normalizeFormat(aliases(catalog, ["sourceFormat", "source_format", "format"]));
    const responseFormat = normalizeFormat(firstValue(
        aliases(responseSource, ["source_format", "sourceFormat", "format"]),
        aliases(result, ["source_format", "sourceFormat", "format"])
    ));
    const format = normalizeFormat(firstValue(
        // A catalogue OMM can be propagated by an SGP4 runtime and therefore
        // receive a generic backend TLE label. Preserve the declared input
        // format rather than silently presenting the product as a TLE.
        declaredFormat,
        responseFormat,
        manual && Object.keys(manual).length ? "MANUAL" : null
    ));
    const kind = normalizedToken(firstValue(responseSource.kind, context.kind));
    const isManual = kind === "manual" || kind === "manual-design" || Boolean(Object.keys(manual).length);
    const definitionSource = normalizeDefinitionSource(firstValue(
        aliases(responseSource, ["definition_source", "definitionSource"]),
        aliases(manual, ["definitionSource", "definition_source"])
    ));
    const type = sourceTypeFor({ format, manual: isManual, definitionSource, methodId });
    const source = {
        type: SOURCE_TYPES.has(type) ? type : "unknown",
        format: format || (isManual ? "MANUAL" : "UNKNOWN"),
        kind: isManual ? "manual" : "catalog",
        origin: firstText(
            aliases(catalog, ["sourceOrigin", "source_origin"]),
            isManual ? "USER" : "CATALOG"
        ),
        id: firstText(
            aliases(responseSource, ["runtime_id", "runtimeId", "sat_id", "satId"]),
            context.sourceId,
            context.id
        ),
        name: firstText(result.satellite, responseSource.name, context.name, manual.name),
        definitionSource: isManual ? definitionSource : null
    };
    source.metadata = sourceMetadata(context, result, source);
    return source;
}

/** Read the endpoint capability without inferring an alternate source/model. */
function backendInspectorCapability(result) {
    const capabilities = record(firstValue(
        result.capabilities,
        result.capability,
        result.inspector_capability,
        result.inspectorCapability
    ));
    return record(firstValue(capabilities.inspector, capabilities));
}

export function assessPropagatedParametersAvailability(context = {}, result = {}) {
    const source = normalizePropagatedParametersSource(context, result);
    const catalog = record(context.catalogMeta);
    const explicit = backendInspectorCapability(result);
    const explicitlyAvailable = bool(firstValue(explicit.available, explicit.supported));
    const explicitReason = firstText(explicit.reason, explicit.message);
    const nativeCartesian = record(firstValue(explicit.native_cartesian, explicit.nativeCartesian));
    const osculatingElements = record(firstValue(explicit.osculating_elements, explicit.osculatingElements));
    const backendResponseObserved = Boolean(
        Object.keys(record(result.source)).length
        || Object.keys(record(result.model)).length
        || Object.keys(record(result.capabilities)).length
        || Array.isArray(result.samples)
    );
    if (explicitlyAvailable === true) {
        return {
            available: true,
            code: "backend-declared",
            reason: explicitReason || null,
            mode: firstText(explicit.mode, explicit.kind),
            nativeCartesian: Object.keys(nativeCartesian).length ? nativeCartesian : null,
            osculatingElements: Object.keys(osculatingElements).length ? osculatingElements : null
        };
    }
    if (explicitlyAvailable === false) {
        return { available: false, code: "backend-unavailable", reason: explicitReason || "El backend no declara esta inspección como disponible." };
    }
    if (source.type === "sp3") {
        if (backendResponseObserved) {
            return {
                available: false,
                code: "backend-capability-missing",
                reason: "El backend no declaró una capacidad de inspección nativa para este SP3.",
                mode: null,
                nativeCartesian: null,
                osculatingElements: null
            };
        }
        return {
            available: true,
            code: "backend-catalog-pending",
            reason: null,
            mode: "native-cartesian",
            nativeCartesian: null,
            osculatingElements: null
        };
    }
    const backendProviderDeclared = bool(firstValue(
        catalog.backendInspectorAvailable,
        catalog.backend_inspector_available,
        catalog.inspectorProvider === "backend"
    )) === true;
    if (source.type === "oem" && record(context.telemetry).oem && !backendProviderDeclared) {
        return {
            available: false,
            code: "local-oem-no-backend-provider",
            reason: "La OEM cargada localmente no tiene un proveedor de analisis registrado en el backend.",
            mode: null,
            nativeCartesian: null,
            osculatingElements: null
        };
    }
    if (source.type === "oem") {
        if (backendResponseObserved) {
            return {
                available: false,
                code: "backend-capability-missing",
                reason: "El backend no declaró una capacidad de inspección nativa para este OEM.",
                mode: null,
                nativeCartesian: null,
                osculatingElements: null
            };
        }
        return {
            available: true,
            code: "backend-catalog-pending",
            reason: null,
            mode: "native-cartesian",
            nativeCartesian: null,
            osculatingElements: null
        };
    }
    if (["tle", "omm", "manual", "state-vector", "numeric"].includes(source.type)) {
        return { available: true, code: "available", reason: null };
    }
    return {
        available: false,
        code: "source-type-unavailable",
        reason: "El tipo de fuente no declara una ruta de inspección orbital compatible."
    };
}

export function normalizePropagatedParametersMethod(context = {}, result = {}) {
    const model = record(result.model);
    const manual = record(context.manualOrbit);
    const id = firstText(model.id, model.applied_engine, context.propagator, manual.propagator);
    const applied = firstText(model.applied_engine, model.appliedEngine, model.id);
    const family = id && normalizedToken(id).startsWith("tabular-")
        ? "tabular"
        : id && normalizedToken(id).includes("sgp4")
            ? "sgp4"
        : isNumericMethod(id)
            ? "numerical"
            : id
                ? "analytical"
                : "unknown";
    return {
        id,
        label: firstText(model.label, model.name, id),
        applied,
        family,
        numerical: family === "numerical",
        integrator: firstText(model.numerical_integrator, model.numericalIntegrator, manual.propagationOptions?.numericalIntegrator, manual.propagation_options?.numerical_integrator),
        stateSource: firstText(model.state_source, model.stateSource)
    };
}

export function normalizePropagatedParametersFrame(context = {}, result = {}) {
    const model = record(result.model);
    const source = record(result.source);
    const capabilities = record(result.capabilities);
    const inspectorCapabilities = record(capabilities.inspector);
    // The API declares this contract at both top level and below
    // capabilities.inspector so old callers can remain useful. Prefer the
    // normalized public contract, never a desired request label: an IGS20
    // state asked for as generic ITRF must still be displayed as IGS20 until a
    // real datum transformation has actually happened.
    const frameContract = [
        result.frame,
        result.frames,
        inspectorCapabilities.frame,
        inspectorCapabilities.frames
    ].map(record).find((candidate) => Object.keys(candidate).length > 0) || {};
    const nativeContract = record(frameContract.native);
    const currentContract = record(frameContract.current);
    const outputContract = record(frameContract.output);
    const calculationContract = record(frameContract.calculation);
    const native = firstText(
        nativeContract.reference_frame,
        result.native_reference_frame,
        result.nativeReferenceFrame,
        model.dynamics_reference_frame,
        model.dynamicsReferenceFrame,
        source.reference_frame,
        source.referenceFrame
    );
    const current = firstText(
        currentContract.reference_frame,
        outputContract.reference_frame,
        result.output_reference_frame,
        result.outputReferenceFrame,
        result.reference_frame,
        result.referenceFrame,
        source.reference_frame,
        source.referenceFrame,
        model.state_reference_frame,
        model.stateReferenceFrame,
        context.referenceFrame,
        native
    );
    const display = firstText(context.displayReferenceFrame, result.display_frame, result.displayFrame, current);
    const availableFrames = [...new Set([
        ...(Array.isArray(frameContract.available_output_frames) ? frameContract.available_output_frames : []),
        ...(Array.isArray(frameContract.availableOutputFrames) ? frameContract.availableOutputFrames : []),
        ...(Array.isArray(frameContract.requestable_output_frames) ? frameContract.requestable_output_frames : []),
        ...(Array.isArray(frameContract.requestableOutputFrames) ? frameContract.requestableOutputFrames : [])
    ].map((value) => text(value)).filter(Boolean))];
    const transformed = bool(outputContract.transformed);
    return {
        current,
        native,
        display,
        requested: firstText(
            outputContract.requested_frame,
            outputContract.requestedFrame,
            result.requested_output_frame,
            result.requestedOutputFrame
        ),
        transformed,
        transformProvenance: firstValue(outputContract.provenance, outputContract.transform_provenance, outputContract.transformProvenance),
        dynamics: firstText(model.dynamics_reference_frame, model.dynamicsReferenceFrame, calculationContract.reference_frame, calculationContract.referenceFrame, native, current),
        calculation: firstText(calculationContract.reference_frame, calculationContract.referenceFrame, model.dynamics_reference_frame, model.dynamicsReferenceFrame, native, current),
        elementsFollowCalculationFrame: bool(firstValue(calculationContract.elements_follow_calculation_frame, calculationContract.elementsFollowCalculationFrame)),
        state: firstText(model.state_reference_frame, model.stateReferenceFrame, current),
        availableFrames: availableFrames.length ? availableFrames : (current ? [current] : []),
        supportedFrames: [...new Set([
            ...(Array.isArray(frameContract.supported_output_frames) ? frameContract.supported_output_frames : []),
            ...(Array.isArray(frameContract.supportedOutputFrames) ? frameContract.supportedOutputFrames : [])
        ].map((value) => text(value)).filter(Boolean))],
        conversions: transformed ? [outputContract.provenance].filter(Boolean) : [],
        selectable: bool(frameContract.selectable) === true,
        frameTransformServiceConfigured: bool(firstValue(frameContract.frame_transform_service_configured, frameContract.frameTransformServiceConfigured)),
        selectionRequiresRuntimeValidation: bool(firstValue(frameContract.selection_requires_runtime_validation, frameContract.selectionRequiresRuntimeValidation)) === true,
        reason: firstText(frameContract.reason) || (
            Object.keys(frameContract).length
                ? null
                : (current
                    ? "La inspección muestra el marco nativo declarado por el servicio."
                    : "El backend no declaró un marco de referencia para esta inspección.")
        )
    };
}

function manualRequestedTerms(context) {
    const manual = record(context.manualOrbit);
    const options = record(firstValue(manual.propagationOptions, manual.propagation_options));
    const raw = firstValue(options.forceTerms, options.force_terms, manual.forceTerms, manual.force_terms);
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((entry) => text(entry).toLowerCase()).filter(Boolean))];
}

export function normalizePropagatedParametersForces(context = {}, result = {}) {
    const model = record(result.model);
    const rawTerms = firstValue(model.force_terms, model.forceTerms);
    const terms = Array.isArray(rawTerms)
        ? [...new Set(rawTerms.map((entry) => text(entry).toLowerCase()).filter(Boolean))]
        : [];
    const declared = Array.isArray(rawTerms);
    return {
        available: declared,
        terms,
        atmosphericDrag: declared ? (bool(firstValue(model.atmospheric_drag, model.atmosphericDrag)) ?? terms.includes("drag")) : null,
        requestedTerms: manualRequestedTerms(context),
        reason: declared ? null : "El backend no declaró los términos de fuerza realmente aplicados."
    };
}

export function normalizePropagatedParametersQuality(context = {}, result = {}) {
    const catalog = record(context.catalogMeta);
    const input = record(firstValue(catalog.inputMetadata, catalog.input_metadata));
    const model = record(result.model);
    const value = firstText(
        aliases(result, ["data_quality", "dataQuality", "quality"]),
        aliases(model, ["data_quality", "dataQuality", "quality"]),
        aliases(input, ["data_quality", "dataQuality", "quality", "product_class", "productClass"]),
        aliases(catalog, ["dataQuality", "data_quality"])
    );
    return {
        available: Boolean(value),
        value,
        source: value ? "declared" : null,
        reason: value ? null : "La fuente no declaró una calidad de datos."
    };
}

export function normalizePropagatedParametersPrecision(context = {}, result = {}) {
    const catalog = record(context.catalogMeta);
    const input = record(firstValue(catalog.inputMetadata, catalog.input_metadata));
    const model = record(result.model);
    const value = firstValue(
        aliases(result, ["precision", "accuracy", "accuracy_m", "accuracyM"]),
        aliases(model, ["precision", "accuracy", "accuracy_m", "accuracyM"]),
        aliases(input, ["precision", "accuracy", "accuracy_m", "accuracyM"]),
        aliases(catalog, ["precision", "accuracy"])
    );
    const numeric = finiteNumber(value);
    const declared = numeric === null ? firstText(value) : numeric;
    return {
        available: declared !== null,
        value: declared,
        unit: declared === null ? null : firstText(
            aliases(result, ["precision_unit", "precisionUnit", "accuracy_unit", "accuracyUnit"]),
            aliases(model, ["precision_unit", "precisionUnit", "accuracy_unit", "accuracyUnit"]),
            aliases(input, ["precision_unit", "precisionUnit", "accuracy_unit", "accuracyUnit"]),
            numeric !== null ? "m" : null
        ),
        reason: declared === null ? "La fuente no declaró una precisión cuantificada." : null
    };
}

function component(value, aliasesList) {
    return finiteNumber(aliases(record(value), aliasesList));
}

function addColumn(columns, seen, column) {
    if (seen.has(column.id)) return;
    seen.add(column.id);
    columns.push(column);
}

function readPath(source, path) {
    let current = source;
    for (const key of text(path).split(".")) {
        if (!key || !current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, key)) {
            return undefined;
        }
        current = current[key];
    }
    return current;
}

function directScalar(value) {
    if (typeof value === "string") return value.trim() ? value : null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean") return value;
    if (Array.isArray(value) && value.length) {
        const normalized = value.map((item) => directScalar(item));
        return normalized.every((item) => item !== null) ? normalized : null;
    }
    return null;
}

function directSources(sample, state) {
    return [
        { value: sample, origin: "sample-direct" },
        { value: state, origin: "state-direct" },
        { value: record(firstValue(sample.provenance, sample.state_provenance, sample.stateProvenance)), origin: "sample-provenance" },
        { value: record(firstValue(state.provenance, state.state_provenance, state.stateProvenance)), origin: "state-provenance" }
    ];
}

function directCandidate(sources, keys, accept = (value) => directScalar(value) !== null) {
    for (const source of sources) {
        for (const key of keys) {
            const value = readPath(source.value, key);
            if (accept(value)) return { value, key, source: source.value, origin: source.origin };
        }
    }
    return null;
}

function directNumberCandidate(sources, keys) {
    return directCandidate(sources, keys, (value) => finiteNumber(value) !== null);
}

function directUnitCandidate(candidate, sources, keys, inferred = null) {
    const orderedSources = candidate
        ? [candidate.source, ...sources.map(({ value }) => value)]
        : sources.map(({ value }) => value);
    for (const source of orderedSources) {
        for (const key of keys) {
            const value = firstText(readPath(source, key));
            if (value) return value;
        }
    }
    return candidate && typeof inferred === "function" ? inferred(candidate.key) : null;
}

function inferredUnitFromFieldKey(key) {
    const token = normalizedToken(key);
    if (token.includes("seconds-per-second") || token.includes("second-per-second")) return "s/s";
    if (/(^|-)(?:km)-s(?:2|-2)($|-)/.test(token)) return "km/s²";
    if (/(^|-)(?:m)-s(?:2|-2)($|-)/.test(token)) return "m/s²";
    if (token.includes("nanosecond") || /(^|-)ns($|-)/.test(token)) return "ns";
    if (token.includes("millisecond") || /(^|-)ms($|-)/.test(token)) return "ms";
    if (token.includes("microsecond") || /(^|-)us($|-)/.test(token)) return "µs";
    if (token.includes("second") || /(^|-)sec($|-)/.test(token)) return "s";
    if (/(^|-)km($|-)/.test(token)) return "km";
    if (/(^|-)m($|-)/.test(token)) return "m";
    return null;
}

// SP3 clock offsets are frequently retained internally in seconds so the
// parser can preserve the original source contract. The inspector presents a
// conventional nanosecond value only when that conversion is unambiguous.
// This is still a direct source value, merely normalized to a display unit.
function clockValueInNanoseconds(value, unit, key) {
    const numeric = finiteNumber(value);
    if (numeric === null) return { value: null, unit: unit || null };
    const unitToken = text(unit).toLowerCase().replace(/[μµ]/g, "u").replace(/\s+/g, "");
    const keyToken = normalizedToken(key);
    const implicitSeconds = !unitToken && (keyToken.includes("second") || keyToken.includes("_sec"));
    const multiplier = unitToken === "s" || unitToken === "sec" || unitToken === "second" || unitToken === "seconds" || implicitSeconds
        ? 1e9
        : unitToken === "ms" || unitToken === "millisecond" || unitToken === "milliseconds"
            ? 1e6
            : unitToken === "us" || unitToken === "microsecond" || unitToken === "microseconds"
                ? 1e3
                : unitToken === "ns" || unitToken === "nanosecond" || unitToken === "nanoseconds"
                    ? 1
                    : null;
    return multiplier === null
        ? { value: numeric, unit: unit || null }
        : { value: numeric * multiplier, unit: "ns" };
}

// Product quality is conventionally read in millimetres. Convert only linear
// length units that are explicit in the source. A clock sigma or an unknown
// quantity keeps its original unit instead of being presented as a position
// precision by assumption.
function linearValueInMillimetres(value, unit) {
    const numeric = finiteNumber(value);
    if (numeric === null) return { value: null, unit: unit || null };
    const unitToken = text(unit).toLowerCase().replace(/[μµ]/g, "u").replace(/\s+/g, "");
    const multiplier = unitToken === "m" || unitToken === "metre" || unitToken === "meter" || unitToken === "metres" || unitToken === "meters"
        ? 1_000
        : unitToken === "cm" || unitToken === "centimetre" || unitToken === "centimeter" || unitToken === "centimetres" || unitToken === "centimeters"
            ? 10
            : unitToken === "mm" || unitToken === "millimetre" || unitToken === "millimeter" || unitToken === "millimetres" || unitToken === "millimeters"
                ? 1
                : null;
    return multiplier === null
        ? { value: numeric, unit: unit || null }
        : { value: numeric * multiplier, unit: "mm" };
}

function covarianceShape(value) {
    if (!Array.isArray(value) || !value.length) return null;
    const widths = value.map((row) => Array.isArray(row) ? row.length : 0);
    if (!widths.every((width) => width > 0)) return null;
    const width = widths.every((candidate) => candidate === widths[0]) ? widths[0] : null;
    return width ? `${value.length}×${width}` : `${value.length} filas`;
}

function covarianceSummary(sources) {
    const matrix = directCandidate(sources, ["covariance"], Array.isArray);
    const metadata = directCandidate(sources, [
        "oem_covariance", "covariance_metadata", "covarianceMetadata", "covariance_info", "covarianceInfo"
    ], (value) => Object.keys(record(value)).length > 0);
    const declared = directCandidate(sources, ["covariance_summary", "covarianceSummary"], (value) => directScalar(value) !== null);
    if (!matrix && !metadata && !declared) return null;

    const details = record(metadata?.value);
    const attached = bool(firstValue(details.attached, details.available, details.present));
    const unit = directUnitCandidate(matrix || metadata || declared, sources, [
        "covariance_units", "covarianceUnits", "covariance_unit", "covarianceUnit"
    ], inferredUnitFromFieldKey);
    const shape = covarianceShape(matrix?.value);
    const referenceFrame = firstText(
        details.state_reference_frame,
        details.stateReferenceFrame,
        details.resolved_reference_frame,
        details.resolvedReferenceFrame,
        details.declared_reference_frame,
        details.declaredReferenceFrame
    );
    const epoch = firstText(details.epoch, details.epoch_utc, details.epochUtc);
    const transformed = bool(firstValue(details.transformed_to_state_frame, details.transformedToStateFrame));
    const reason = firstText(details.reason);
    const source = matrix || metadata || declared;
    const summary = declared && typeof declared.value === "string"
        ? declared.value
        : [
            attached === false ? "No adjunta" : shape ? `Matriz ${shape}` : attached === true ? "Disponible" : "Declarada",
            referenceFrame,
            transformed === true ? "transformada al marco de estado" : null,
            reason
        ].filter(Boolean).join(" · ");
    return {
        summary,
        unit,
        origin: source.origin,
        details: {
            available: matrix ? true : (attached ?? true),
            attached: attached ?? Boolean(matrix),
            dimensions: shape,
            unit,
            referenceFrame: referenceFrame || null,
            epoch: epoch || null,
            transformedToStateFrame: transformed,
            reason: reason || null,
            matrix: matrix?.value ?? null,
            provenance: metadata?.value ?? null
        }
    };
}

/** Flatten actual backend samples into portable table/export rows. No vector
 * component or unit is invented: fields appear only when the response had a
 * finite component and retain the state-declared unit. */
export function normalizePropagatedParametersRows(result = {}, inspectorSource = null) {
    const samples = Array.isArray(result.samples) ? result.samples : [];
    const source = record(inspectorSource);
    const sourceMetadata = record(source.metadata);
    const rows = [];
    const columns = [];
    const seen = new Set();
    const cartesianColumns = [];
    const cartesianSeen = new Set();
    const positionUnits = new Set();
    const velocityUnits = new Set();
    const supplementalUnits = new Map();
    const supplementalOrigins = new Map();

    for (const sampleValue of samples) {
        const sample = record(sampleValue);
        const state = record(sample.state);
        const position = record(firstValue(state.position, sample.position));
        const velocity = record(firstValue(state.velocity, sample.velocity));
        const sources = directSources(sample, state);
        const row = {};
        const time = firstText(sample.time, sample.timestamp, sample.utc, sample.date);
        const referenceFrame = firstText(sample.reference_frame, sample.referenceFrame, state.reference_frame, state.referenceFrame, result.reference_frame, result.referenceFrame);
        const nativeReferenceFrame = firstText(
            sample.native_reference_frame,
            sample.nativeReferenceFrame,
            state.native_reference_frame,
            state.nativeReferenceFrame
        );
        const timeScale = firstText(sample.time_scale, sample.timeScale, state.time_scale, state.timeScale);
        if (time) row.time = time;
        if (referenceFrame) row.referenceFrame = referenceFrame;
        if (nativeReferenceFrame) row.nativeReferenceFrame = nativeReferenceFrame;
        if (timeScale) row.timeScale = timeScale;
        if (time) addColumn(columns, seen, { id: "time", label: "UTC", unit: null, group: "identity" });
        if (referenceFrame) addColumn(columns, seen, { id: "referenceFrame", label: "Marco", unit: null, group: "identity" });
        if (timeScale) addColumn(columns, seen, {
            id: "timeScale",
            label: "Escala temporal",
            unit: null,
            group: "identity",
            type: "text",
            direct: true,
            derived: false,
            provenance: "state-direct"
        });
        const nativeProvenance = record(firstValue(state.provenance, sample.provenance));
        if (Object.keys(nativeProvenance).length) row.nativeProvenance = nativeProvenance;
        const frameTransform = record(firstValue(sample.frame_transform, sample.frameTransform));
        if (Object.keys(frameTransform).length) row.frameTransform = frameTransform;
        const sampling = record(sample.sampling);
        if (Object.keys(sampling).length) row.sampling = sampling;

        const positionUnit = firstText(state.position_units, state.positionUnits, sample.position_units, sample.positionUnits);
        const velocityUnit = firstText(state.velocity_units, state.velocityUnits, sample.velocity_units, sample.velocityUnits);
        if (positionUnit) positionUnits.add(positionUnit);
        if (velocityUnit) velocityUnits.add(velocityUnit);
        const cartesian = {};
        const positions = {
            x: component(position, ["x", "x_km", "xKm", "x_m", "xM"]),
            y: component(position, ["y", "y_km", "yKm", "y_m", "yM"]),
            z: component(position, ["z", "z_km", "zKm", "z_m", "zM"])
        };
        const velocities = {
            vx: component(velocity, ["x", "vx", "x_km_s", "xKmS", "vx_km_s", "vxKmS", "x_m_s", "xMS"]),
            vy: component(velocity, ["y", "vy", "y_km_s", "yKmS", "vy_km_s", "vyKmS", "y_m_s", "yMS"]),
            vz: component(velocity, ["z", "vz", "z_km_s", "zKmS", "vz_km_s", "vzKmS", "z_m_s", "zMS"])
        };
        for (const [id, label, group] of CARTESIAN_COLUMNS) {
            const value = positions[id] ?? velocities[id];
            if (!Number.isFinite(value)) continue;
            const unit = group === "position" ? positionUnit : velocityUnit;
            row[id] = value;
            cartesian[id] = value;
            const column = {
                id,
                label,
                unit: unit || null,
                group,
                type: "number",
                direct: true,
                derived: false,
                provenance: "state-direct"
            };
            addColumn(columns, seen, column);
            addColumn(cartesianColumns, cartesianSeen, column);
        }
        if (Object.keys(cartesian).length) {
            row.cartesian = {
                ...cartesian,
                positionUnit: positionUnit || null,
                velocityUnit: velocityUnit || null
            };
        }

        const addDirectField = ({ id, label, value, unit = null, group, origin, type = "number" }) => {
            if (value === null || value === undefined) return;
            row[id] = value;
            if (!row.fieldProvenance) row.fieldProvenance = {};
            row.fieldProvenance[id] = origin;
            if (unit) {
                if (!row.fieldUnits) row.fieldUnits = {};
                row.fieldUnits[id] = unit;
                if (!supplementalUnits.has(id)) supplementalUnits.set(id, new Set());
                supplementalUnits.get(id).add(unit);
            }
            if (!supplementalOrigins.has(id)) supplementalOrigins.set(id, new Set());
            supplementalOrigins.get(id).add(origin);
            addColumn(columns, seen, {
                id,
                label,
                unit: unit || null,
                group,
                type,
                direct: true,
                derived: false,
                provenance: "direct"
            });
        };

        for (const axis of ["x", "y", "z"]) {
            const upper = axis.toUpperCase();
            const candidate = directNumberCandidate(sources, [
                `acceleration.${axis}`, `a.${axis}`,
                `acceleration_${axis}_km_s2`, `acceleration${upper}KmS2`, `a${axis}_km_s2`, `a${upper}KmS2`,
                `acceleration_${axis}_m_s2`, `acceleration${upper}MS2`, `a${axis}_m_s2`, `a${upper}MS2`,
                `acceleration_${axis}`, `acceleration${upper}`, `a_${axis}`, `a${axis}`
            ]);
            if (!candidate) continue;
            addDirectField({
                id: `a${axis}`,
                label: `A${axis}`,
                value: finiteNumber(candidate.value),
                unit: directUnitCandidate(candidate, sources, [
                    "acceleration_units", "accelerationUnits", "acceleration_unit", "accelerationUnit", "a_units", "aUnits"
                ], inferredUnitFromFieldKey),
                group: "acceleration",
                origin: candidate.origin,
                type: "acceleration"
            });
        }

        const clock = directNumberCandidate(sources, [
            "clock.bias_ns", "clock.offset_ns", "clock_ns", "clockNs", "clock_offset_ns", "clockOffsetNs",
            "clock.bias_seconds", "clock.offset_seconds", "clock_seconds", "clockSeconds", "clock_offset_seconds", "clockOffsetSeconds",
            "clock_bias_seconds", "clockBiasSeconds", "sp3_clock_bias_seconds", "clock_offset", "clockOffset", "clock"
        ]);
        if (clock) {
            const sourceUnit = directUnitCandidate(clock, sources, [
                "clock_units", "clockUnits", "clock_unit", "clockUnit", "clock_bias_units", "clockBiasUnits"
            ], inferredUnitFromFieldKey);
            const normalizedClock = clockValueInNanoseconds(clock.value, sourceUnit, clock.key);
            addDirectField({
                id: "clock",
                label: "Reloj",
                value: normalizedClock.value,
                unit: normalizedClock.unit,
                group: "clock",
                origin: clock.origin
            });
        }
        const clockRate = directNumberCandidate(sources, [
            "clock.rate_seconds_per_second", "clock_rate_seconds_per_second", "clockRateSecondsPerSecond",
            "sp3_clock_rate_seconds_per_second", "clock_rate", "clockRate"
        ]);
        if (clockRate) {
            addDirectField({
                id: "clockRate",
                label: "Deriva de reloj",
                value: finiteNumber(clockRate.value),
                unit: directUnitCandidate(clockRate, sources, [
                    "clock_rate_units", "clockRateUnits", "clock_rate_unit", "clockRateUnit"
                ], inferredUnitFromFieldKey),
                group: "clock",
                origin: clockRate.origin
            });
        }
        const clockSigma = directNumberCandidate(sources, [
            "clock.sigma_ns", "clock_sigma_ns", "clockSigmaNs",
            "clock.sigma_seconds", "clock_sigma_seconds", "clockSigmaSeconds",
            "sp3_clock_sigma_seconds"
        ]);
        if (clockSigma) {
            const sourceUnit = directUnitCandidate(clockSigma, sources, [
                "clock_sigma_units", "clockSigmaUnits", "clock_sigma_unit", "clockSigmaUnit"
            ], inferredUnitFromFieldKey);
            const normalizedClockSigma = clockValueInNanoseconds(clockSigma.value, sourceUnit, clockSigma.key);
            addDirectField({
                id: "clockSigma",
                label: "Sigma de reloj",
                value: normalizedClockSigma.value,
                unit: normalizedClockSigma.unit,
                group: "clock",
                origin: clockSigma.origin
            });
        }

        const sigma = directNumberCandidate(sources, [
            "sigma", "position_sigma", "positionSigma", "sigma_position", "sigmaPosition",
            "quality.sigma", "quality.position_sigma", "quality.positionSigma"
        ]);
        if (sigma) {
            const sourceUnit = directUnitCandidate(sigma, sources, [
                "sigma_units", "sigmaUnits", "sigma_unit", "sigmaUnit", "position_sigma_units", "positionSigmaUnits",
                "quality.sigma_units", "quality.sigmaUnits"
            ], inferredUnitFromFieldKey);
            const normalizedSigma = linearValueInMillimetres(sigma.value, sourceUnit);
            addDirectField({
                id: "sigma",
                label: "Sigma",
                value: normalizedSigma.value,
                unit: normalizedSigma.unit,
                group: "quality",
                origin: sigma.origin
            });
        }
        // SP3 ``++`` is a satellite/file-wide one-sigma orbit declaration,
        // not a per-epoch/component residual. Keep it in its own column so a
        // reader never mistakes a header accuracy for an instantaneous sigma.
        const headerOrbitSigma = directNumberCandidate(sources, [
            "sp3_header_orbit_sigma_mm", "sp3HeaderOrbitSigmaMm"
        ]);
        if (headerOrbitSigma) {
            addDirectField({
                id: "sp3HeaderOrbitSigma",
                label: "Sigma orbital SP3",
                value: finiteNumber(headerOrbitSigma.value),
                unit: directUnitCandidate(headerOrbitSigma, sources, [
                    "sp3_header_orbit_sigma_units", "sp3HeaderOrbitSigmaUnits"
                ], inferredUnitFromFieldKey),
                group: "quality",
                origin: headerOrbitSigma.origin
            });
        }
        const rms = directNumberCandidate(sources, [
            "rms", "position_rms", "positionRms", "rms_position", "rmsPosition", "quality.rms", "quality.position_rms", "quality.positionRms"
        ]);
        if (rms) {
            const sourceUnit = directUnitCandidate(rms, sources, [
                "rms_units", "rmsUnits", "rms_unit", "rmsUnit", "position_rms_units", "positionRmsUnits",
                "quality.rms_units", "quality.rmsUnits"
            ], inferredUnitFromFieldKey);
            const normalizedRms = linearValueInMillimetres(rms.value, sourceUnit);
            addDirectField({
                id: "rms",
                label: "RMS",
                value: normalizedRms.value,
                unit: normalizedRms.unit,
                group: "quality",
                origin: rms.origin
            });
        }
        const quality = directCandidate(sources, [
            "quality_flag", "qualityFlag", "data_quality", "dataQuality", "status",
            "quality.status", "quality.code", "quality.class", "quality.level", "quality"
        ]);
        if (quality) {
            addDirectField({
                id: "quality",
                label: "Calidad",
                value: directScalar(quality.value),
                group: "quality",
                origin: quality.origin,
                type: "quality"
            });
        }
        const eventFlag = directCandidate(sources, [
            "event_flag", "eventFlag", "event_type", "eventType", "event_flags", "eventFlags", "events", "event", "flags.event"
        ]);
        if (eventFlag) {
            addDirectField({
                id: "event",
                label: "Evento",
                value: directScalar(eventFlag.value),
                group: "event",
                origin: eventFlag.origin,
                type: "flag"
            });
        }
        const maneuverFlag = directCandidate(sources, [
            "maneuver_flag", "maneuverFlag", "manoeuvre_flag", "manoeuvreFlag", "has_maneuver", "hasManeuver",
            "has_manoeuvre", "hasManoeuvre", "maneuvers", "manoeuvres", "maneuver", "manoeuvre", "flags.maneuver"
        ]);
        if (maneuverFlag) {
            addDirectField({
                id: "maneuver",
                label: "Maniobra",
                value: directScalar(maneuverFlag.value),
                group: "event",
                origin: maneuverFlag.origin,
                type: "flag"
            });
        }
        const covariance = covarianceSummary(sources);
        if (covariance) {
            row.covarianceDetails = covariance.details;
            addDirectField({
                id: "covariance",
                label: "Covarianza",
                value: covariance.summary,
                unit: covariance.unit,
                group: "covariance",
                origin: covariance.origin,
                type: "text"
            });
        }

        // OMM mean elements are source input, not a time-varying osculating
        // series. They remain visible/exportable alongside every returned
        // epoch with an explicit source-input provenance rather than being
        // renamed as state-derived elements. Only fields truly retained from
        // the OMM metadata are emitted.
        if (source.type === "omm") {
            const ommInputFields = [
                ["meanSemiMajorAxisKm", "a medio", "km", ["mean_semi_major_axis_km", "meanSemiMajorAxisKm"]],
                ["meanEccentricity", "e medio", null, ["mean_eccentricity", "meanEccentricity"]],
                ["meanInclinationDeg", "i medio", "deg", ["mean_inclination_deg", "meanInclinationDeg"]],
                ["meanRaanDeg", "RAAN medio", "deg", ["mean_raan_deg", "meanRaanDeg"]],
                ["meanArgumentOfPeriapsisDeg", "Argumento de periapsis medio", "deg", ["mean_argument_of_periapsis_deg", "meanArgumentOfPeriapsisDeg"]],
                ["meanAnomalyDegInput", "Anomalia media de entrada", "deg", ["mean_anomaly_deg_input", "meanAnomalyDegInput"]],
                ["meanMotionRevDay", "Movimiento medio", "rev/d", ["mean_motion_rev_day", "meanMotionRevDay"]],
                ["bstar", "B* drag", null, ["bstar", "bStar"]],
                ["solarRadiationPressure", "SRP", null, ["solar_radiation_pressure", "solarRadiationPressure"]],
                ["dragCoefficient", "Coeficiente de drag", null, ["drag_coefficient", "dragCoefficient"]]
            ];
            for (const [id, label, unit, keys] of ommInputFields) {
                const rawValue = aliases(sourceMetadata, keys);
                const value = directScalar(rawValue);
                if (value === null) continue;
                addDirectField({
                    id,
                    label,
                    value,
                    unit,
                    group: "mean-input",
                    origin: "source-input",
                    type: typeof value === "number" ? "number" : "text"
                });
            }
        }

        const elements = record(firstValue(sample.elements, sample.osculating_elements, sample.osculatingElements));
        for (const [id, label, unit, keys] of DERIVED_COLUMNS) {
            const value = finiteNumber(aliases(elements, keys));
            if (value === null) continue;
            row[id] = value;
            addColumn(columns, seen, {
                id,
                label,
                unit: unit || null,
                group: "derived",
                derived: true,
                provenance: "backend-derived"
            });
        }
        // Native tabular sources intentionally omit osculating elements in a
        // terrestrial frame. The Cartesian norm remains an exact, useful
        // derived quantity, but publish it only when every required component
        // actually arrived from the backend and identify its provenance.
        const derived = {};
        if (!Number.isFinite(row.radiusKm)
            && [row.x, row.y, row.z].every((value) => Number.isFinite(value))) {
            row.radiusKm = Math.hypot(row.x, row.y, row.z);
            derived.radiusKm = "cartesian-position-magnitude";
            addColumn(columns, seen, {
                id: "radiusKm",
                label: "Radio",
                unit: positionUnit || null,
                group: "derived",
                derived: true,
                provenance: "cartesian-position-magnitude"
            });
        }
        if (!Number.isFinite(row.speedKmS)
            && [row.vx, row.vy, row.vz].every((value) => Number.isFinite(value))) {
            row.speedKmS = Math.hypot(row.vx, row.vy, row.vz);
            derived.speedKmS = "cartesian-velocity-magnitude";
            addColumn(columns, seen, {
                id: "speedKmS",
                label: "Velocidad",
                unit: velocityUnit || null,
                group: "derived",
                derived: true,
                provenance: "cartesian-velocity-magnitude"
            });
        }
        if (Object.keys(derived).length) row.derived = derived;
        rows.push(row);
    }

    const unitFor = (values) => values.size === 1 ? [...values][0] : null;
    const resolvedCartesian = cartesianColumns.map((column) => ({
        ...column,
        unit: column.group === "position" ? unitFor(positionUnits) : unitFor(velocityUnits),
        unitVaries: column.group === "position" ? positionUnits.size > 1 : velocityUnits.size > 1
    }));
    const resolvedColumns = columns.map((column) => {
        const cartesian = resolvedCartesian.find((candidate) => candidate.id === column.id);
        if (cartesian) return cartesian;
        const units = supplementalUnits.get(column.id);
        const origins = supplementalOrigins.get(column.id);
        if (!units && !origins) return column;
        return {
            ...column,
            unit: units?.size === 1 ? [...units][0] : null,
            unitVaries: Boolean(units && units.size > 1),
            origins: origins ? [...origins] : []
        };
    });
    return { rows, columns: resolvedColumns, cartesianColumns: resolvedCartesian };
}

function rangeMetadata(result) {
    const startTime = firstText(result.start_time, result.startTime);
    const endTime = firstText(result.end_time, result.endTime);
    return startTime || endTime ? { startTime, endTime } : null;
}

/** Build the complete runtime-to-panel model from only declared facts. */
export function buildPropagatedParametersInspector(context = {}, result = {}) {
    const source = normalizePropagatedParametersSource(context, result);
    const availability = assessPropagatedParametersAvailability(context, result);
    const method = normalizePropagatedParametersMethod(context, result);
    const frame = normalizePropagatedParametersFrame(context, result);
    const quality = normalizePropagatedParametersQuality(context, result);
    const forces = normalizePropagatedParametersForces(context, result);
    const precision = normalizePropagatedParametersPrecision(context, result);
    const { rows, columns, cartesianColumns } = normalizePropagatedParametersRows(result, source);
    return {
        version: 1,
        source,
        availability,
        method,
        frame,
        quality,
        forces,
        precision,
        rows,
        columns,
        cartesianColumns,
        range: rangeMetadata(result),
        sampleCount: rows.length
    };
}

function serializablePresentationValue(value, seen = new WeakSet()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (Array.isArray(value)) {
        return value.map((item) => serializablePresentationValue(item, seen));
    }
    if (!value || typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);
    const safe = {};
    for (const [key, item] of Object.entries(value)) {
        const normalized = serializablePresentationValue(item, seen);
        if (normalized !== undefined) safe[key] = normalized;
    }
    seen.delete(value);
    return safe;
}

function safePresentationMetadata(value) {
    return record(serializablePresentationValue(record(value)));
}

function selectedRows(allRows, scope, rows) {
    if (scope !== "visible") return allRows;
    if (!Array.isArray(rows)) return [];
    const indexes = new Set();
    const orderedIndexes = [];
    const timeIndexes = new Map();
    for (const [index, row] of allRows.entries()) {
        const key = row?.time;
        if (!timeIndexes.has(key)) timeIndexes.set(key, []);
        timeIndexes.get(key).push(index);
    }
    const selectIndex = (index) => {
        if (!Number.isInteger(index) || index < 0 || index >= allRows.length || indexes.has(index)) return false;
        indexes.add(index);
        orderedIndexes.push(index);
        return true;
    };
    for (const item of rows) {
        if (Number.isInteger(item)) {
            selectIndex(item);
            continue;
        }
        const row = record(item);
        // A filtered/sorted view normally preserves object identity. Honour it
        // first, because two distinct samples can legitimately share an epoch.
        if (selectIndex(allRows.indexOf(item))) continue;
        // Export callers may give lightweight row copies instead. Consume the
        // next unselected index for that epoch rather than collapsing it into
        // one Map entry as the old time -> index mapping did.
        const candidates = timeIndexes.get(row.time) || [];
        for (const index of candidates) {
            if (selectIndex(index)) break;
        }
    }
    return orderedIndexes.map((index) => allRows[index]);
}

function selectedColumns(columns, requested) {
    if (!Array.isArray(requested) || !requested.length) return columns;
    const allowed = new Set(requested.map((item) => typeof item === "string" ? item : record(item).id).map(text).filter(Boolean));
    return columns.filter((column) => allowed.has(column.id));
}

/**
 * Keep row-level provenance in JSON exports without mixing operational
 * metadata into the human-readable CSV cell matrix. The array order matches
 * ``rows`` exactly, including duplicate epochs, so a consumer can associate a
 * covariance, interpolation statement, or direct-field unit with the proper
 * sample without guessing from time alone.
 */
function exportRowMetadata(row, exportRow) {
    const details = {
        exportRow,
        epoch: firstText(row?.time) || null,
        referenceFrame: firstText(row?.referenceFrame) || null,
        nativeReferenceFrame: firstText(row?.nativeReferenceFrame) || null,
        timeScale: firstText(row?.timeScale) || null,
        cartesianUnits: Object.keys(record(row?.cartesian)).length
            ? {
                position: firstText(row?.cartesian?.positionUnit) || null,
                velocity: firstText(row?.cartesian?.velocityUnit) || null
            }
            : null,
        fieldUnits: Object.keys(record(row?.fieldUnits)).length ? row.fieldUnits : null,
        fieldProvenance: Object.keys(record(row?.fieldProvenance)).length ? row.fieldProvenance : null,
        derived: Object.keys(record(row?.derived)).length ? row.derived : null,
        sampling: Object.keys(record(row?.sampling)).length ? row.sampling : null,
        covariance: Object.keys(record(row?.covarianceDetails)).length ? row.covarianceDetails : null,
        frameTransform: Object.keys(record(row?.frameTransform)).length ? row.frameTransform : null,
        nativeProvenance: Object.keys(record(row?.nativeProvenance)).length ? row.nativeProvenance : null
    };
    return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== null));
}

function csvCell(value) {
    const textValue = value === undefined || value === null ? "" : String(value);
    return `"${textValue.replaceAll('"', '""')}"`;
}

/**
 * Build a serializable export payload. Main owns the actual download so the
 * same model can be tested without DOM APIs and can be requested by React via
 * a custom event.
 */
export function buildPropagatedParametersExport({
    context = {}, result = {}, inspector = buildPropagatedParametersInspector(context, result), format = "json", scope = "all", rows = null, columns = null, metadata = null, generatedAtUtc = null
} = {}) {
    const normalizedFormat = normalizedToken(format) === "csv" ? "csv" : "json";
    const normalizedScope = normalizedToken(scope) === "visible" ? "visible" : "all";
    const resolvedRows = selectedRows(inspector.rows, normalizedScope, rows);
    const resolvedColumns = selectedColumns(inspector.columns, columns);
    const exportMetadata = {
        schema: "orbit.propagated-parameters/v1",
        generatedAtUtc: firstText(generatedAtUtc) || new Date().toISOString(),
        source: inspector.source,
        availability: inspector.availability,
        method: inspector.method,
        frame: inspector.frame,
        quality: inspector.quality,
        forces: inspector.forces,
        precision: inspector.precision,
        range: inspector.range,
        simulationRange: serializablePresentationValue(context.simulationRange) ?? null,
        scope: normalizedScope,
        columns: resolvedColumns,
        rowCount: resolvedRows.length,
        presentation: safePresentationMetadata(metadata)
    };
    const projectedRows = resolvedRows.map((row) => Object.fromEntries(
        resolvedColumns.map((column) => [column.id, row[column.id] ?? null])
    ));
    const rowMetadata = resolvedRows.map((row, index) => exportRowMetadata(row, index + 1));
    const document = { metadata: exportMetadata, rows: projectedRows, rowMetadata };
    const header = resolvedColumns.map((column) => column.unit ? `${column.label} (${column.unit})` : column.label);
    const csv = [
        "# Orbit propagated parameters",
        `# metadata: ${JSON.stringify(exportMetadata)}`,
        header.map(csvCell).join(","),
        ...projectedRows.map((row) => resolvedColumns.map((column) => csvCell(row[column.id])).join(","))
    ].join("\n");
    return {
        format: normalizedFormat,
        scope: normalizedScope,
        metadata: exportMetadata,
        rows: projectedRows,
        rowMetadata,
        columns: resolvedColumns,
        document,
        content: normalizedFormat === "csv" ? csv : JSON.stringify(document, null, 2),
        mimeType: normalizedFormat === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8"
    };
}
