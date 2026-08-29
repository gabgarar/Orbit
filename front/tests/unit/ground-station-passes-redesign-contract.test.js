import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
    new URL("../../../react-ui/src/components/GroundStationsPanel.jsx", import.meta.url),
    "utf8"
);

test("the AOS/LOS workspace exposes an operational header and one compact station, RF and satellite context summary", () => {
    assert.match(source, /data-testid="ground-station-pass-operational-header"/);
    assert.match(source, /TABLAS AOS\s*\/\s*LOS/);
    assert.match(source, /Análisis de pases de satélite/);

    assert.match(source, /data-testid="ground-station-pass-context-summary"/);
    assert.match(source, /data-testid="ground-station-pass-station-summary"/);
    assert.match(source, /data-testid="ground-station-pass-rf-summary"/);
    assert.match(source, /data-testid="ground-station-pass-satellite-summary"/);
    assert.match(source, /Estación activa/);
    assert.match(source, /Configuración RF/);
    assert.match(source, /Satélite/);
});

test("the AOS/LOS workspace keeps the result panel and CSV export separate from the selectable pass table", () => {
    assert.match(source, /data-testid="ground-station-pass-results"/);
    assert.match(source, /Resultado de pases/);
    assert.match(source, /Exportar CSV/);

    assert.match(source, /data-testid="ground-station-pass-table"/);
    assert.match(source, /data-testid="ground-station-pass-row"/);
    assert.match(source, /AOS \(\{displayTimeZone\}\)/);
    assert.match(source, /LOS \(\{displayTimeZone\}\)/);
    assert.match(source, /aria-selected=\{selected\}/);
    assert.match(source, /onSelectPass=\{setSelectedPassIndex\}/);
});

test("selecting a pass opens a dedicated elevation profile with operational KPIs", () => {
    assert.match(source, /selectedPass \? <PassElevationChart/);
    assert.match(source, /data-testid="ground-station-pass-profile"/);
    assert.match(source, /data-testid="ground-station-pass-kpis"/);
    assert.match(source, /(?:Máx\. elevación|M&aacute;x\. elevaci&oacute;n)/);
    assert.match(source, /(?:Duración del pase|Duraci&oacute;n del pase)/);
    assert.match(source, />AOS</);
    assert.match(source, />LOS</);
    assert.match(source, /Exportar PNG/);
});
