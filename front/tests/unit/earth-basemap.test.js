import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_EARTH_BASEMAP_ID,
    createEarthBasemapManager,
    getEarthBasemapChoices,
    normalizeEarthBasemapId
} from "../../js/rendering/earthBasemap.js";

function createEvent() {
    const listeners = new Set();
    return {
        addEventListener(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        removeEventListener(listener) {
            listeners.delete(listener);
        },
        raise(error) {
            for (const listener of [...listeners]) listener(error);
        }
    };
}

function createCesiumStub() {
    class UrlTemplateImageryProvider {
        constructor(options) {
            this.options = options;
            this.errorEvent = createEvent();
        }
    }
    class GeographicTilingScheme {}
    class WebMercatorTilingScheme {}
    class Credit {
        constructor(text) {
            this.text = text;
        }
    }
    return {
        UrlTemplateImageryProvider,
        GeographicTilingScheme,
        WebMercatorTilingScheme,
        Credit,
        Rectangle: { fromDegrees: (...degrees) => ({ degrees }) }
    };
}

function createLayerCollection() {
    const values = [];
    return {
        get length() { return values.length; },
        get(index) { return values[index]; },
        contains(layer) { return values.includes(layer); },
        addImageryProvider(imageryProvider, index = values.length) {
            const layer = { imageryProvider };
            values.splice(index, 0, layer);
            return layer;
        },
        remove(layer) {
            const index = values.indexOf(layer);
            if (index < 0) return false;
            values.splice(index, 1);
            return true;
        },
        raiseToTop(layer) {
            const index = values.indexOf(layer);
            if (index < 0) return;
            values.splice(index, 1);
            values.push(layer);
        },
        values
    };
}

function createManager(options = {}) {
    const Cesium = createCesiumStub();
    const imageryLayers = createLayerCollection();
    const nightLayer = { name: "night" };
    imageryLayers.values.push(nightLayer);
    const viewer = { scene: { imageryLayers } };
    const manager = createEarthBasemapManager({
        viewer,
        Cesium,
        nightImageryLayer: {
            attach: () => nightLayer,
            getLayer: () => nightLayer
        },
        logger: { warn() {} },
        ...options
    });
    return { Cesium, imageryLayers, manager, nightLayer };
}

test("Earth basemap choices keep local sources usable in offline Docker mode", () => {
    const choices = getEarthBasemapChoices({ localEarth2kmAvailable: false, offlineMode: true });
    const byId = Object.fromEntries(choices.map((choice) => [choice.id, choice]));

    assert.equal(byId["natural-earth"].available, true);
    assert.equal(byId["earth2km-local"].available, false);
    assert.equal(byId.openstreetmap.available, false);
    assert.equal(byId["esri-world-imagery"].available, false);
    assert.equal(normalizeEarthBasemapId("openstreetmap", { offlineMode: true }), DEFAULT_EARTH_BASEMAP_ID);
});

test("switching base maps retains night imagery above the day base", () => {
    const { manager, imageryLayers, nightLayer } = createManager();
    manager.apply("natural-earth");
    const naturalLayer = imageryLayers.values.find((layer) => layer !== nightLayer);

    assert.match(naturalLayer.imageryProvider.options.url, /NaturalEarthII/);
    assert.equal(imageryLayers.values.at(-1), nightLayer);

    manager.apply("openstreetmap");
    const osmLayer = imageryLayers.values.find((layer) => layer !== nightLayer);
    assert.match(osmLayer.imageryProvider.options.url, /tile\.openstreetmap\.org/);
    assert.equal(imageryLayers.values.includes(naturalLayer), false);
    assert.equal(imageryLayers.values.at(-1), nightLayer);
});

test("an unavailable local Earth 2 km request falls back and activates when its tiles appear", () => {
    const { manager, imageryLayers, nightLayer } = createManager({ localEarth2kmAvailable: false });
    const fallback = manager.apply("earth2km-local");

    assert.equal(fallback.requestedId, "earth2km-local");
    assert.equal(fallback.selectedId, DEFAULT_EARTH_BASEMAP_ID);
    assert.equal(fallback.fallbackReason, "local-tiles-unavailable");

    const activated = manager.setLocalEarth2kmAvailable(true);
    const localLayer = imageryLayers.values.find((layer) => layer !== nightLayer);
    assert.equal(activated.selectedId, "earth2km-local");
    assert.match(localLayer.imageryProvider.options.url, /earth2km_tiles/);
});

test("repeated remote imagery failures return safely to the local map", () => {
    const { manager, imageryLayers, nightLayer } = createManager();
    manager.apply("openstreetmap");
    const remoteLayer = imageryLayers.values.find((layer) => layer !== nightLayer);

    remoteLayer.imageryProvider.errorEvent.raise(new Error("offline"));
    assert.equal(manager.getState().selectedId, "openstreetmap");
    remoteLayer.imageryProvider.errorEvent.raise(new Error("offline"));

    const activeLayer = imageryLayers.values.find((layer) => layer !== nightLayer);
    assert.equal(manager.getState().selectedId, DEFAULT_EARTH_BASEMAP_ID);
    assert.equal(manager.getState().requestedId, "openstreetmap");
    assert.equal(manager.getState().fallbackReason, "remote-provider-unavailable");
    assert.match(activeLayer.imageryProvider.options.url, /NaturalEarthII/);
});
