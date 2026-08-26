import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(
    new URL("../../../react-ui/src/components/PropagatedOrbitParametersPanel.jsx", import.meta.url),
    "utf8"
);
const styles = readFileSync(
    new URL("../../../react-ui/src/styles.css", import.meta.url),
    "utf8"
);

test("the ephemerides inspector opens as a centred top-level window above workspace layers", () => {
    assert.match(panelSource, /import \{ createPortal \} from "react-dom"/);
    assert.match(panelSource, /const INSPECTOR_MODAL_Z_INDEX = 2147483000/);
    assert.match(panelSource, /function centeredWindowRect\(rect = DEFAULT_WINDOW_RECT\)/);
    assert.match(panelSource, /x: Math\.round\(\(viewport\.width - normalized\.width\) \/ 2\)/);
    assert.match(panelSource, /y: Math\.round\(\(viewport\.height - normalized\.height\) \/ 2\)/);
    assert.match(panelSource, /const panelWasOpenRef = useRef\(false\)/);
    assert.match(panelSource, /panel\.open && !panelWasOpenRef\.current/);
    assert.match(panelSource, /setWindowRect\(\(current\) => centeredWindowRect\(current\)\)/);
    assert.match(panelSource, /const portalTarget = typeof document === "undefined" \? null : document\.body/);
    assert.match(panelSource, /return createPortal\(<aside[\s\S]*?<\/aside>, portalTarget\)/);
    assert.match(panelSource, /zIndex: INSPECTOR_MODAL_Z_INDEX/);
    assert.match(panelSource, /event\.key !== "Escape"/);
    assert.match(panelSource, /tabIndex=\{-1\}/);
    assert.match(styles, /\.propagated-orbit-parameters-panel\s*\{\s*z-index: 2147483000 !important;/);
    const sharedPanelTreatment = styles.match(/\/\* Shared translucent treatment[\s\S]*?\.propagated-orbit-parameters-panel \{[\s\S]*?\n\}/)?.[0] || "";
    assert.doesNotMatch(sharedPanelTreatment, /z-index:/);
});

test("information selects use the inspector visual system instead of native browser chrome", () => {
    const rangeSelector = /\[data-testid="propagated-parameters-simulation-range"\] select/;
    assert.match(styles, rangeSelector);
    assert.match(styles, /-webkit-appearance: none;[\s\S]*?appearance: none;/);
    assert.match(styles, /background-image: url\("data:image\/svg\+xml/);
    assert.match(styles, /select:hover:not\(:disabled\)/);
    assert.match(styles, /select:focus-visible/);
});

test("the information tab owns a themed contained scroll region", () => {
    const informationStart = panelSource.indexOf("function InformationTab(");
    const informationEnd = panelSource.indexOf("function ChartParameterPicker(");
    const informationTab = panelSource.slice(informationStart, informationEnd);

    assert.notEqual(informationStart, -1);
    assert.notEqual(informationEnd, -1);
    assert.match(informationTab, /data-testid="propagated-parameters-information-scroll-region"/);
    assert.match(informationTab, /\borbit-scrollbar\b/);
    assert.match(informationTab, /\boverflow-y-auto\b/);
    assert.match(informationTab, /tabIndex=\{0\}/);
    assert.match(styles, /\[data-testid="propagated-parameters-information-scroll-region"\]\s*\{[\s\S]*?overscroll-behavior-y:\s*contain;/);
});

test("the chart uses readable scale ticks and explains source and visual interpolation separately", () => {
    assert.match(panelSource, /function chartTickStep\(span, targetCount = 5\)/);
    assert.match(panelSource, /function chartTickPrecision\(step\)/);
    assert.match(panelSource, /function chartYAxis\(minimum, maximum\)/);
    assert.match(panelSource, /formatChartAxisValue\(value, yAxis\.step\)/);
    assert.match(panelSource, /function describeSourceInterpolation\(sample\)/);
    assert.match(panelSource, /function describeSeriesInterpolation\(samples\)/);
    assert.match(panelSource, /function tooltipNarrative\(tooltip\)/);
    assert.match(panelSource, /LECTURA DEL TRAZO/);
    assert.match(panelSource, /Lectura lineal entre dos muestras consecutivas/);
    assert.match(panelSource, /seriesInterpolation=\{seriesInterpolation\}/);
    assert.match(panelSource, /height: "clamp\(220px, 34vh, 310px\)"/);
    assert.match(panelSource, /const host = svg\?\.parentElement/);
    assert.match(panelSource, /point\.matrixTransform\(matrix\)/);
    assert.match(panelSource, /tooltip\.placement\?\.x/);
    assert.match(panelSource, /flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0\.5/);
});

test("the chart picker is built from every numeric Values column and exposes provenance", () => {
    assert.match(panelSource, /function chartOptionsForProfile\(profile, samples, referenceFrame, inspector\)/);
    assert.match(panelSource, /valueColumnsForProfile\(profile, samples, referenceFrame, inspector\)/);
    assert.match(panelSource, /const NON_CHARTABLE_COLUMN_TYPES = new Set\(\["time", "frame", "text", "flag"\]\)/);
    assert.match(panelSource, /Number\.isFinite\(finiteNumericColumnValue\(column, sample\)\)/);
    assert.match(panelSource, /getValue: \(sample\) => finiteNumericColumnValue\(column, sample\)/);
    assert.match(panelSource, /id: "mean-motion", label: "Movimiento medio \(rev\/d\)"/);
    assert.match(panelSource, /function applyInspectorCartesianColumnMetadata\(column, inspector\)/);
    assert.match(panelSource, /function ProvenanceBadge\(\{ provenance, className = "" \}\)/);
    assert.match(panelSource, /DATOS DIRECTOS/);
    assert.match(panelSource, /VALORES DERIVADOS/);
    assert.match(panelSource, /option\.getValue\?\.\(sample\)/);
    assert.match(panelSource, /samples=\{valueSamples\} profile=\{profile\} chartColumnId=\{chartColumnId\}/);
    assert.doesNotMatch(panelSource, /availability\?\.available === false \|\| osculatingUnavailable/);
});

test("the inspector presents a project-owned, metadata-only propagation history table", () => {
    assert.match(panelSource, /function PropagationHistorySection\(\{ history \}\)/);
    assert.match(panelSource, /data-testid="propagated-parameters-history"/);
    assert.match(panelSource, /Historial de propagaciones/);
    assert.match(panelSource, /sin guardar las muestras/);
    assert.match(panelSource, /<PropagationHistorySection history=\{propagationHistory\} \/>/);
    assert.match(panelSource, /history: \[\]/);
    assert.match(panelSource, /COMPLETADA/);
    assert.match(panelSource, /EN CURSO/);
});

test("an expensive selected cadence explains its active task without showing a false cap", () => {
    assert.match(panelSource, /samplingPlan\?\.fullResolution === true && samplingPlan\?\.expensive === true && busy/);
    assert.match(panelSource, /data-testid="propagated-parameters-detailed-sampling-notice"/);
    assert.match(panelSource, /Cálculo detallado en curso\./);
    assert.match(panelSource, /la tarea está disponible arriba a la derecha/);
    assert.match(panelSource, /samplingPlan\?\.limited === true/);
});
