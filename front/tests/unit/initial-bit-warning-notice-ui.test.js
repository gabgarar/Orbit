import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");
const hook = readFileSync(
    new URL("../../../react-ui/src/hooks/useInitialBitWarningNotice.js", import.meta.url),
    "utf8"
);
const notice = readFileSync(
    new URL("../../../react-ui/src/components/overlays/InitialBitWarningNotice.jsx", import.meta.url),
    "utf8"
);

test("completed initial-BIT warnings are visible, actionable, and non-modal", () => {
    assert.match(app, /useInitialBitWarningNotice\(systemDiagnostics\.diagnostics\)/);
    assert.match(app, /<InitialBitWarningNotice notice=\{initialBitWarning\.notice\}/);
    assert.match(app, /onOpenDiagnostics=\{\(\) => setDiagnosticsOpen\(true\)\}/);
    assert.match(hook, /shownRef/);
    assert.match(hook, /shownRef\.current = true/);
    assert.match(hook, /setNotice\(candidate\)/);
    assert.match(notice, /data-testid="initial-bit-warning-notice"/);
    assert.match(notice, /role="alert"/);
    assert.match(notice, /aria-atomic="true"/);
    assert.match(notice, /Revisar BIT/);
    assert.match(notice, /Descartar avisos de la comprobación inicial de BIT/);
    assert.doesNotMatch(notice, /aria-modal/);
});
