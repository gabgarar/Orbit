import assert from "node:assert/strict";
import test from "node:test";

import { buildUniformSampleTimes, sampleTrackKinematics } from "../../js/runtime/trackKinematics.js";

test("samples simulated velocity and acceleration from neighbouring track points", () => {
    // x = 5t² metres at t = 0, 1 and 2 seconds: v(1) = 10 m/s,
    // a = 10 m/s². The renderer linearly interpolates these samples, while
    // acceleration is estimated from the adjacent segment velocities.
    const points = [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 20, y: 0, z: 0 }
    ];
    const sample = sampleTrackKinematics(points, [0, 1000, 2000], 1000);

    assert.deepEqual(sample?.position, { x: 5, y: 0, z: 0 });
    assert.deepEqual(sample?.velocity, { x: 15, y: 0, z: 0 });
    assert.deepEqual(sample?.acceleration, { x: 10, y: 0, z: 0 });
});

test("does not manufacture simulated kinematics outside or without a valid track", () => {
    const points = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
    assert.equal(sampleTrackKinematics(points, [0, 1000], -1), null);
    assert.equal(sampleTrackKinematics(points, [1000, 1000], 1000), null);
    assert.deepEqual(buildUniformSampleTimes(3, 0, 2000), [0, 1000, 2000]);
});
