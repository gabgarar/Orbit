import assert from "node:assert/strict";
import test from "node:test";

import { chartPngFilename, downloadChartPng } from "../../js/runtime/chartPngExport.js";

function createExportEnvironment() {
    const attributes = new Map();
    const backgroundAttributes = new Map();
    const lifecycle = { appended: [], clicks: 0, removed: 0, revoked: [], timeouts: [] };
    const contextCalls = [];
    let image;
    let serializedSvg;
    const anchor = {
        click: () => { lifecycle.clicks += 1; },
        remove: () => { lifecycle.removed += 1; }
    };
    const canvas = {
        getContext: () => ({
            scale: (...args) => contextCalls.push(["scale", ...args]),
            drawImage: (...args) => contextCalls.push(["drawImage", ...args])
        }),
        toBlob: (callback, type) => {
            lifecycle.pngType = type;
            callback(new FakeBlob(["png"], { type }));
        }
    };
    const clonedSvg = {
        firstChild: { id: "chart-line" },
        insertBefore: (node, reference) => {
            lifecycle.insertedBackground = node;
            lifecycle.backgroundReference = reference;
        },
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: (name) => attributes.get(name) || null
    };
    const svg = {
        viewBox: { baseVal: { width: 900, height: 400 } },
        getBoundingClientRect: () => ({ width: 300, height: 160 }),
        cloneNode: (deep) => {
            lifecycle.clonedDeeply = deep;
            return clonedSvg;
        }
    };

    class FakeImage {
        set src(value) {
            this.source = value;
        }

        constructor() {
            image = this;
        }
    }

    class FakeSerializer {
        serializeToString(value) {
            serializedSvg = value;
            return "<svg data-export='chart'/>";
        }
    }

    const documentRef = {
        createElementNS: (_namespace, tagName) => {
            assert.equal(tagName, "rect");
            return { setAttribute: (name, value) => backgroundAttributes.set(name, value) };
        },
        createElement: (tagName) => {
            if (tagName === "canvas") return canvas;
            if (tagName === "a") return anchor;
            throw new Error("Unexpected element " + tagName);
        },
        body: { appendChild: (node) => lifecycle.appended.push(node) }
    };
    const windowRef = {
        devicePixelRatio: 3,
        getComputedStyle: () => ({ fontFamily: "Orbit Sans" }),
        setTimeout: (callback, delay) => lifecycle.timeouts.push({ callback, delay })
    };
    const urlApi = {
        createObjectURL: (blob) => blob.type.startsWith("image/svg") ? "blob:svg" : "blob:png",
        revokeObjectURL: (url) => lifecycle.revoked.push(url)
    };

    return {
        attributes,
        backgroundAttributes,
        canvas,
        contextCalls,
        documentRef,
        image: () => image,
        lifecycle,
        options: { windowRef, documentRef, urlApi, BlobCtor: FakeBlob, ImageCtor: FakeImage, XMLSerializerCtor: FakeSerializer },
        serializedSvg: () => serializedSvg,
        svg
    };
}

class FakeBlob {
    constructor(parts, { type }) {
        this.parts = parts;
        this.type = type;
    }
}

test("builds stable and filesystem-safe PNG filenames for propagated charts", () => {
    assert.equal(chartPngFilename("semi major axis"), "orbit-semi-major-axis-chart.png");
    assert.equal(chartPngFilename("***"), "orbit-parameter-chart.png");
    assert.equal(chartPngFilename(), "orbit-parameter-chart.png");
});

test("exports the current SVG chart to a scaled PNG and cleans up its temporary URLs", () => {
    const environment = createExportEnvironment();

    downloadChartPng(environment.svg, "semi major axis", environment.options);

    const image = environment.image();
    assert.equal(image.source, "blob:svg");
    assert.equal(environment.lifecycle.clonedDeeply, true);
    assert.ok(environment.serializedSvg());
    assert.equal(environment.backgroundAttributes.get("fill"), "#071321");
    assert.equal(environment.attributes.get("width"), "300");
    assert.equal(environment.attributes.get("height"), "160");
    assert.equal(environment.attributes.get("viewBox"), "0 0 300 160");
    assert.equal(environment.attributes.get("font-family"), "Orbit Sans");

    image.onload();

    assert.equal(environment.canvas.width, 600);
    assert.equal(environment.canvas.height, 320);
    assert.deepEqual(environment.contextCalls, [
        ["scale", 2, 2],
        ["drawImage", image, 0, 0, 300, 160]
    ]);
    assert.equal(environment.lifecycle.pngType, "image/png");
    assert.equal(environment.lifecycle.appended.length, 1);
    assert.equal(environment.lifecycle.appended[0].href, "blob:png");
    assert.equal(environment.lifecycle.appended[0].download, "orbit-semi-major-axis-chart.png");
    assert.equal(environment.lifecycle.clicks, 1);
    assert.equal(environment.lifecycle.removed, 1);
    assert.deepEqual(environment.lifecycle.revoked, ["blob:svg"]);
    assert.deepEqual(environment.lifecycle.timeouts.map(({ delay }) => delay), [0]);

    environment.lifecycle.timeouts[0].callback();
    assert.deepEqual(environment.lifecycle.revoked, ["blob:svg", "blob:png"]);
});

test("is harmless without browser APIs and releases the SVG URL after image failures", () => {
    assert.doesNotThrow(() => downloadChartPng(null, "speed", { windowRef: null }));

    const environment = createExportEnvironment();
    downloadChartPng(environment.svg, "speed", environment.options);
    environment.image().onerror();

    assert.deepEqual(environment.lifecycle.revoked, ["blob:svg"]);
    assert.equal(environment.lifecycle.appended.length, 0);
});
