import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    getActiveSimulationRange,
    SIMULATION_MODE_RANGE,
    SIMULATION_MODE_REALTIME,
    SIMULATION_MODE_STATIC
} from "../../js/runtime/simulation/simulationState.js";

const runtimeSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const panelSource = readFileSync(
    new URL("../../../react-ui/src/components/PropagatedOrbitParametersPanel.jsx", import.meta.url),
    "utf8"
);

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `missing source section ${startMarker}`);
    return source.slice(start, end);
}

test("the active simulation domain is a valid, explicit range and otherwise fails closed", () => {
    const range = getActiveSimulationRange({
        mode: SIMULATION_MODE_RANGE,
        startDate: new Date("2026-08-20T09:00:00Z"),
        endDate: new Date("2026-08-20T12:30:00Z")
    });

    assert.deepEqual(range, {
        mode: "range",
        source: "simulation-range",
        startTime: "2026-08-20T09:00:00.000Z",
        endTime: "2026-08-20T12:30:00.000Z"
    });

    for (const state of [
        { mode: SIMULATION_MODE_REALTIME, startDate: range.startTime, endDate: range.endTime },
        { mode: SIMULATION_MODE_STATIC, startDate: range.startTime, endDate: range.endTime },
        { mode: SIMULATION_MODE_RANGE, startDate: "not-a-date", endDate: range.endTime },
        { mode: SIMULATION_MODE_RANGE, startDate: range.startTime, endDate: range.startTime }
    ]) {
        assert.equal(getActiveSimulationRange(state), null);
    }
});

test("the propagated-parameters inspector follows simulation-domain changes, not playhead ticks", () => {
    const synchronizer = sourceBetween(
        runtimeSource,
        "function syncPropagatedParametersForSimulationState()",
        "window.addEventListener(\"orbit:simulation-state\", syncPropagatedParametersForSimulationState)"
    );

    assert.match(runtimeSource, /getActiveSimulationRange\(simulationState\)/);
    assert.match(runtimeSource, /window\.addEventListener\("orbit:simulation-state",\s*syncPropagatedParametersForSimulationState\)/);
    assert.match(synchronizer, /propagatedParametersInspectorState\.open/);
    assert.match(synchronizer, /manual-design/);
    assert.match(synchronizer, /getActiveSimulationRange\(simulationState\)/);
    assert.match(synchronizer, /requestPropagatedParameters\(/);
    assert.match(synchronizer, /(?:range|domain|simulation)Key/);
});

test("the inspector presents the active simulation range as read-only and has no route to apply an analysis range", () => {
    const informationTab = sourceBetween(
        panelSource,
        "function InformationTab(",
        "function ChartParameterPicker"
    );

    assert.match(informationTab, /panel\?\.simulationRange|panel\.simulationRange/);
    assert.match(informationTab, /data-testid="propagated-parameters-simulation-range"/);
    assert.match(informationTab, /Rango de simulaci(?:ó|\\u00f3)n/);
    assert.doesNotMatch(informationTab, /<input\b|datetime-local/);
    assert.doesNotMatch(informationTab, /\b(?:onUpdateRange|onApplySimulation|updateRange|applySimulation)\b/);
    assert.doesNotMatch(panelSource, /orbit:propagated-parameters-(?:range-change|apply-simulation)/);
    assert.doesNotMatch(runtimeSource, /orbit:propagated-parameters-(?:range-change|apply-simulation)/);
});

test("source profiles preserve declared provenance and fail closed instead of inventing a replacement source", () => {
    const profiles = sourceBetween(panelSource, "function profileKind(", "function metadataSources(");
    const methodValues = sourceBetween(panelSource, "function methodValue(", "function sourceMethodNarrative(");
    const narratives = sourceBetween(panelSource, "function sourceMethodNarrative(", "function methodFieldsForProfile(");
    const valuesTab = sourceBetween(panelSource, "function ValuesTab(", "const RESIZE_HANDLES");

    for (const kind of ["tle", "sp3", "oem", "omm", "state-vector", "numeric", "manual"]) {
        assert.match(profiles, new RegExp(`return "${kind}";`));
    }
    assert.match(profiles, /sourceProfile[\s\S]*?source_format[\s\S]*?input_type/);
    assert.match(profiles, /\["type", "format", "sourceFormat", "source_format", "inputType", "input_type", "kind", "source"\]/);
    assert.match(profiles, /inspector\?\.method\?\.family === "numerical"/);
    assert.match(profiles, /const candidate =[\s\S]*?\?\? source[\s\S]*?\?\? propagator/);
    assert.match(methodValues, /if \(!isPresentValue\(value\)\) return "No disponible en esta fuente"/);
    assert.match(narratives, /procede exclusivamente de los metadatos recibidos por el runtime/);
    assert.match(valuesTab, /inspector\?\.availability\?\.available === false[\s\S]*?No se muestran datos de otra fuente ni elementos inferidos/);
    assert.match(valuesTab, /data-testid="propagated-parameters-values-unavailable"/);
});

test("the values contract distinguishes common Cartesian inputs from derived and profile-specific columns", () => {
    const magnitude = sourceBetween(panelSource, "function vectorMagnitude(", "function formatTableValue(");
    const columns = sourceBetween(panelSource, "const BASE_VALUE_COLUMNS", "function inputTimeToMs(");

    for (const id of ["epoch", "frame", "x", "y", "z", "vx", "vy", "vz"]) {
        assert.match(columns, new RegExp(`id: "${id}"[\\s\\S]*?provenance: "direct"`));
    }
    for (const id of ["radius", "speed"]) {
        assert.match(columns, new RegExp(`id: "${id}"[\\s\\S]*?provenance: "derived"`));
    }
    assert.match(magnitude, /coordinates\.every\(Number\.isFinite\)[\s\S]*?Math\.hypot/);
    assert.match(columns, /profile\?\.kind === "omm"[\s\S]*?OMM_MEAN_VALUE_COLUMNS[\s\S]*?OSCULLATING_VALUE_COLUMNS|profile\?\.kind === "omm"[\s\S]*?OMM_MEAN_VALUE_COLUMNS[\s\S]*?OSCULATING_VALUE_COLUMNS/);
    // Source-specific direct fields (clock, quality, acceleration, events,
    // covariance) come from the normalized inspector descriptors. This keeps
    // their actual unit/type and avoids a second hard-coded SP3/numerical
    // column for the same value.
    assert.match(columns, /descriptor\?\.type \|\| "number"/);
    assert.match(columns, /unit: descriptor\?\.unit \|\| null/);
    assert.doesNotMatch(columns, /SP3_QUALITY_VALUE_COLUMNS|NUMERIC_VALUE_COLUMNS/);
    assert.match(columns, /inspectorColumns\(inspector, samples\)/);
    assert.match(columns, /filter\(\(column\) => column && hasColumnValues\(samples, column\)\)/);
});

test("time filtering and export retain row scope, selected columns, and provenance metadata", () => {
    const filtering = sourceBetween(panelSource, "function rowsForTimeFilter(", "function sortValueRows(");
    const valuesTab = sourceBetween(panelSource, "function ValuesTab(", "const RESIZE_HANDLES");
    const exportBridge = sourceBetween(panelSource, "const requestExport = (payload) =>", "if (!panel.open)");

    assert.match(filtering, /if \(!epoch\) return false/);
    assert.match(filtering, /timestamp >= start[\s\S]*?timestamp <= end/);
    assert.match(valuesTab, /scope === "visible" \? sortedRows\.map\(\(row\) => row\.sample\) : samples/);
    assert.match(valuesTab, /data-testid="propagated-parameters-values-tab"/);
    assert.match(panelSource, /data-testid="propagated-parameters-cartesian-table"/);
    assert.match(valuesTab, /data-testid="propagated-parameters-export-menu"/);
    assert.match(valuesTab, /columns: safeVisibleColumns\.map\(\(\{ id, label, type, provenance \}\)/);
    assert.match(valuesTab, /timeFilter: \{ \.\.\.timeFilter \}/);
    assert.match(valuesTab, /sort: \{ \.\.\.sort \}/);
    assert.match(valuesTab, /rowCount: rows\.length/);
    assert.match(valuesTab, /requestExport\("csv", "visible"\)/);
    assert.match(valuesTab, /requestExport\("json", "all"\)/);
    assert.match(exportBridge, /emit\("orbit:propagated-parameters-export"/);
    assert.match(exportBridge, /panel\.exportMetadata[\s\S]*?result\?\.exportMetadata[\s\S]*?payload\.metadata/);
});

test("the export bridge derives provenance from the normalized inspector and reports a result event", () => {
    const exporter = sourceBetween(
        runtimeSource,
        "function exportPropagatedParameters(detail = {})",
        "function setupPropagatedParametersEntryBridge()"
    );

    assert.match(runtimeSource, /window\.addEventListener\("orbit:propagated-parameters-export",[\s\S]*?exportPropagatedParameters/);
    assert.match(runtimeSource, /orbit:propagated-parameters-export-result/);
    assert.match(exporter, /simulationRange: propagatedParametersInspectorState\.simulationRange \?\? null/);
    assert.match(exporter, /inspector\.availability\?\.available === false/);
    assert.match(exporter, /buildPropagatedParametersExport\(\{[\s\S]*?context,[\s\S]*?rows: detail\?\.rows,[\s\S]*?columns: detail\?\.columns,[\s\S]*?metadata: detail\?\.metadata/);
    assert.match(exporter, /metadata: exported\.metadata/);
    assert.doesNotMatch(exporter, /detail\?\.source/);
});
