import assert from "node:assert/strict";
import test from "node:test";

import { getObjectDetailFieldHelp, normalizeObjectDetailFieldLabel } from "../../../react-ui/src/features/objectDetails/fieldHelp.js";
import { buildObjectDetails } from "../../../react-ui/src/features/objectDetails/detailRows.js";

const asObject = (rows) => Object.fromEntries(rows.map(([label, value]) => [label, value]));

test("object detail field help describes SP3 source, frame and companion fields", () => {
    assert.equal(normalizeObjectDetailFieldLabel("Época de cabecera"), "epoca de cabecera");
    assert.match(getObjectDetailFieldHelp("Marco nativo"), /archivo SP3/i);
    assert.match(getObjectDetailFieldHelp("Cobertura del producto"), /no extrapola/i);
    assert.match(getObjectDetailFieldHelp("Cadencia media"), /muestras válidas/i);
    assert.match(getObjectDetailFieldHelp("Interpolación"), /tabuladas/i);
    assert.match(getObjectDetailFieldHelp("Archivo ERP"), /rotación terrestre/i);
    assert.match(getObjectDetailFieldHelp("Archivo CLK"), /reloj/i);
    assert.match(getObjectDetailFieldHelp("Archivo ATT / OBX"), /actitud/i);
    assert.match(getObjectDetailFieldHelp("Archivo OSB / BIA"), /sesgos/i);
    assert.match(getObjectDetailFieldHelp("Estado de representación"), /mostrarse/i);
});

test("time-scale help distinguishes source SP3 time from the simulation speed", () => {
    assert.match(
        getObjectDetailFieldHelp("Escala temporal", { sourceFormat: "SP3", section: "input" }),
        /declarada por el proveedor/i
    );
    assert.match(
        getObjectDetailFieldHelp("Escala temporal", { sourceFormat: "SP3", section: "telemetry" }),
        /factor de avance/i
    );
});

test("SP3 inspector only surfaces companion counts that its selected satellite actually carries", () => {
    const details = buildObjectDetails({
        id: "precise:demo:C06",
        sourceFormat: "SP3",
        catalogMeta: { sourceFormat: "SP3" },
        telemetry: {
            id: "precise:demo:C06",
            source_format: "SP3",
            sp3: {
                satellite_id: "C06",
                product_name: "IGS MGEX final",
                product_id: "precise-demo",
                record_type: "V",
                interpolation: { method: "LAGRANGE", degree: 9, sample_count: 10 },
                clock: {
                    sp3_embedded: { present: true, sample_count: 288 },
                    rinex_clk: { present: true, sample_count: 240 }
                },
                erp: { present: true, file: "product.erp", sample_count: 96 }
            }
        }
    });
    const input = asObject(details.rows.input);

    assert.equal(input["ID de producto"], "precise-demo");
    assert.equal(input["Velocidades publicadas"], "Sí · registros V");
    assert.equal(input["Ventana de interpolación"], "10 épocas");
    assert.equal(input["Muestras de reloj SP3"], "288");
    assert.equal(input["Muestras de reloj CLK"], "240");
    assert.equal(input["Muestras ERP"], "96");
    assert.equal(input.NORAD, undefined);
});
