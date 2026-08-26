import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(
    new URL("../../../react-ui/src/components/overlays/BuiltInTestPanel.jsx", import.meta.url),
    "utf8"
);
const app = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");
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
    assert.match(panel, /font-\[var\(--orbit-font-sans\)\]/);
});

test("BIT receives the project-owned history independently of the ephemerides window", () => {
    assert.match(app, /window\.addEventListener\("orbit:propagated-parameters-state", receivePropagationHistory\)/);
    assert.match(app, /setPropagationHistory\(Array\.isArray\(history\) \? history : \[\]\)/);
    assert.match(app, /propagationHistory=\{propagationHistory\}/);
    assert.match(notice, /font-\[var\(--orbit-font-sans\)\]/);
});
