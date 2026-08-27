import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(
    new URL("../../../react-ui/src/components/overlays/BuiltInTestPanel.jsx", import.meta.url),
    "utf8"
);
const app = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../../react-ui/src/styles.css", import.meta.url), "utf8");
const notice = readFileSync(
    new URL("../../../react-ui/src/components/overlays/InitialBitWarningNotice.jsx", import.meta.url),
    "utf8"
);

test("BIT separates operational data into navigable tabs and keeps audit export in BIT", () => {
    assert.match(panel, /const BIT_TABS = Object\.freeze/);
    assert.match(panel, /label: "Resumen"/);
    assert.match(panel, /label: "Servicios"/);
    assert.match(panel, /label: "Validación"/);
    assert.match(panel, /label: "Auditoría"/);
    assert.match(panel, /role="tablist"/);
    assert.match(panel, /role="tabpanel"/);
    assert.match(panel, /data-testid="bit-audit-tab"/);
    assert.match(panel, /CSV/);
    assert.match(panel, /JSON/);
    assert.match(panel, /downloadAuditSnapshot/);
    assert.match(panel, /orbit-bit-panel/);
    assert.match(panel, /orbit-bit-panel__tabs/);
    assert.doesNotMatch(panel, /font-\[var\(--orbit-font-sans\)\]/);
    assert.match(styles, /\.orbit-bit-panel,[\s\S]*?font-family: var\(--orbit-font-sans\) !important;/);
    assert.match(styles, /\.orbit-bit-panel :is\(button, input, select, textarea, summary\)/);
});

test("BIT receives the project-owned history independently of the ephemerides window", () => {
    assert.match(app, /window\.addEventListener\("orbit:propagated-parameters-state", receivePropagationHistory\)/);
    assert.match(app, /setPropagationHistory\(Array\.isArray\(history\) \? history : \[\]\)/);
    assert.match(app, /propagationHistory=\{propagationHistory\}/);
    assert.match(notice, /orbit-bit-warning-notice/);
    assert.doesNotMatch(notice, /font-\[var\(--orbit-font-sans\)\]/);
    assert.match(styles, /\.orbit-bit-warning-notice/);
});
