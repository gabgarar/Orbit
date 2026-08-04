import assert from "node:assert/strict";
import test from "node:test";

import {
    getBodyGroupPresentation,
    getLayerPresentation,
    isBodyLayer,
    isEarthLayer
} from "../../js/features/layers/layerPresentation.js";

test("layer presentations use distinct semantic icons instead of type text badges", () => {
    const satellite = getLayerPresentation("SATELLITE", "25544");
    const station = getLayerPresentation("GROUND_STATION", "station:madrid");

    assert.equal(satellite.key, "satellite");
    assert.match(satellite.icon, /<svg/);
    assert.equal(station.key, "ground-station");
    assert.notEqual(station.icon, satellite.icon);
});

test("celestial and Earth aliases are grouped as Bodies", () => {
    assert.equal(getLayerPresentation("CELESTIAL_BODY", "body:moon").key, "moon");
    assert.equal(getLayerPresentation("CELESTIAL_BODY", "body:sun").key, "sun");
    assert.equal(getLayerPresentation("EARTH", "body:earth").key, "earth");
    assert.equal(getLayerPresentation("", "body:earth").key, "earth");
    assert.equal(isBodyLayer("CELESTIAL_BODY", "body:moon"), true);
    assert.equal(isBodyLayer("EARTH", "body:earth"), true);
    assert.equal(isBodyLayer("SATELLITE", "25544"), false);
    assert.equal(isEarthLayer("EARTH", "body:earth"), true);
    assert.equal(isEarthLayer("CELESTIAL_BODY", "body:moon"), false);
});

test("Bodies uses its own group icon rather than a satellite or generic layer icon", () => {
    const group = getBodyGroupPresentation();
    const satellite = getLayerPresentation("SATELLITE", "25544");

    assert.equal(group.key, "bodies");
    assert.match(group.icon, /<svg/);
    assert.notEqual(group.icon, satellite.icon);
});
