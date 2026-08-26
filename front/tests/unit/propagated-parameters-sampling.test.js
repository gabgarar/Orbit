import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    PROPAGATED_PARAMETERS_AUTOMATIC_MAX_SAMPLES,
    normalizePropagatedParametersSamplingInterval,
    resolvePropagatedParametersSampling
} from "../../js/features/propagatedParameters/sampling.js";

const runtimeSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");

test("an explicit one-minute cadence keeps every requested sample instead of the former 121-point cap", () => {
    const fiveHours = resolvePropagatedParametersSampling({ hours: 5 }, 60);
    assert.equal(fiveHours.sampleCount, 301);
    assert.equal(fiveHours.requestedSamples, 301);
    assert.equal(fiveHours.effectiveIntervalSeconds, 60);
    assert.equal(fiveHours.limited, false);
    assert.equal(fiveHours.fullResolution, true);
    assert.equal(fiveHours.expensive, true);
    assert.match(fiveHours.taskMessage, /301 muestras completas/);
    assert.match(fiveHours.taskMessage, /puede tardar unos momentos/);

    const fullDay = resolvePropagatedParametersSampling({ hours: 24 }, 60);
    assert.equal(fullDay.sampleCount, 1_441);
    assert.equal(fullDay.effectiveIntervalSeconds, 60);
    assert.equal(fullDay.longRunning, true);
});

test("explicit cadences can cross the previous backend 2,000-sample ceiling without client coarsening", () => {
    const twoDaysAtOneMinute = resolvePropagatedParametersSampling({ hours: 48 }, 60);
    assert.equal(twoDaysAtOneMinute.sampleCount, 2_881);
    assert.equal(twoDaysAtOneMinute.requestedSamples, 2_881);
    assert.equal(twoDaysAtOneMinute.limited, false);
    assert.equal(twoDaysAtOneMinute.fullResolution, true);
});

test("automatic sampling remains an explicit bounded policy rather than a false selected-cadence limit", () => {
    const automatic = resolvePropagatedParametersSampling({ hours: 365 * 24 });
    assert.equal(automatic.mode, "automatic");
    assert.equal(automatic.sampleCount, PROPAGATED_PARAMETERS_AUTOMATIC_MAX_SAMPLES);
    assert.equal(automatic.limited, false);
    assert.equal(automatic.fullResolution, false);
    assert.equal(automatic.requestedIntervalSeconds, null);
    assert.equal(normalizePropagatedParametersSamplingInterval(60), 60);
    assert.equal(normalizePropagatedParametersSamplingInterval(61), null);
});

test("the runtime exposes expensive inspector work through the shared operation task", () => {
    assert.match(runtimeSource, /from "\.\/js\/features\/propagatedParameters\/sampling\.js"/);
    assert.match(runtimeSource, /sampling = resolvePropagatedParametersSampling\([\s\S]*?propagatedParametersSamplingIntervalSeconds/);
    assert.match(runtimeSource, /title: sampling\.taskTitle/);
    assert.match(runtimeSource, /stage: sampling\.taskStage/);
    assert.match(runtimeSource, /sampling\.taskMessage/);
    assert.match(runtimeSource, /if \(sampling\.expensive\)[\s\S]*?orbit:operations-open/);
    assert.doesNotMatch(runtimeSource, /PROPAGATED_PARAMETERS_MAX_SAMPLES\s*=\s*121/);
});
