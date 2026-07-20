/**
 * Frame-agnostic finite differences for an already sampled ephemeris track.
 *
 * The caller owns the reference frame and the units.  Orbit uses metres and
 * seconds internally, so the returned velocity and acceleration are m/s and
 * m/s² when the input points are metres.
 */
function finiteVector(value) {
    if (!value || typeof value !== "object") return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

function validTimes(times, length) {
    if (!Array.isArray(times) || times.length !== length || length < 2) return false;
    let previous = Number.NEGATIVE_INFINITY;
    for (const time of times) {
        const numeric = Number(time);
        if (!Number.isFinite(numeric) || numeric <= previous) return false;
        previous = numeric;
    }
    return true;
}

function subtract(left, right) {
    return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function divide(vector, divisor) {
    return { x: vector.x / divisor, y: vector.y / divisor, z: vector.z / divisor };
}

function scale(vector, factor) {
    return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function interpolate(left, right, ratio) {
    return {
        x: left.x + ((right.x - left.x) * ratio),
        y: left.y + ((right.y - left.y) * ratio),
        z: left.z + ((right.z - left.z) * ratio)
    };
}

function segmentVelocity(points, times, leftIndex, rightIndex) {
    const left = finiteVector(points[leftIndex]);
    const right = finiteVector(points[rightIndex]);
    const elapsedSeconds = (Number(times[rightIndex]) - Number(times[leftIndex])) / 1000;
    if (!left || !right || !(elapsedSeconds > 0)) return null;
    return divide(subtract(right, left), elapsedSeconds);
}

function accelerationAroundSegment(points, times, leftIndex) {
    const current = segmentVelocity(points, times, leftIndex, leftIndex + 1);
    if (!current) return null;

    const previous = leftIndex > 0
        ? segmentVelocity(points, times, leftIndex - 1, leftIndex)
        : null;
    const next = leftIndex + 2 < points.length
        ? segmentVelocity(points, times, leftIndex + 1, leftIndex + 2)
        : null;

    if (previous) {
        const beforeSeconds = (Number(times[leftIndex]) - Number(times[leftIndex - 1])) / 1000;
        const currentSeconds = (Number(times[leftIndex + 1]) - Number(times[leftIndex])) / 1000;
        const spanSeconds = beforeSeconds + currentSeconds;
        return spanSeconds > 0 ? scale(subtract(current, previous), 2 / spanSeconds) : null;
    }
    if (next) {
        const currentSeconds = (Number(times[leftIndex + 1]) - Number(times[leftIndex])) / 1000;
        const afterSeconds = (Number(times[leftIndex + 2]) - Number(times[leftIndex + 1])) / 1000;
        const spanSeconds = currentSeconds + afterSeconds;
        return spanSeconds > 0 ? scale(subtract(next, current), 2 / spanSeconds) : null;
    }
    return null;
}

function locateSegment(times, atMs) {
    const lastIndex = times.length - 1;
    if (atMs < Number(times[0]) || atMs > Number(times[lastIndex])) return null;
    if (atMs === Number(times[lastIndex])) return lastIndex - 1;

    let low = 0;
    let high = lastIndex;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (Number(times[middle]) <= atMs) low = middle;
        else high = middle;
    }
    return low;
}

/**
 * Sample a piecewise-linear ephemeris at `atMs` and derive its local
 * kinematics from neighbouring samples.  It intentionally returns null when
 * the sample timing is unavailable instead of borrowing a realtime vector.
 */
export function sampleTrackKinematics(points, sampleTimesMs, atMs) {
    const track = Array.isArray(points) ? points : [];
    const targetMs = Number(atMs);
    if (!Number.isFinite(targetMs) || !validTimes(sampleTimesMs, track.length)) return null;

    const leftIndex = locateSegment(sampleTimesMs, targetMs);
    if (leftIndex === null) return null;
    const rightIndex = leftIndex + 1;
    const left = finiteVector(track[leftIndex]);
    const right = finiteVector(track[rightIndex]);
    const startMs = Number(sampleTimesMs[leftIndex]);
    const endMs = Number(sampleTimesMs[rightIndex]);
    if (!left || !right || !(endMs > startMs)) return null;

    const ratio = Math.max(0, Math.min(1, (targetMs - startMs) / (endMs - startMs)));
    return {
        position: interpolate(left, right, ratio),
        velocity: segmentVelocity(track, sampleTimesMs, leftIndex, rightIndex),
        acceleration: accelerationAroundSegment(track, sampleTimesMs, leftIndex),
        leftIndex,
        rightIndex
    };
}

export function buildUniformSampleTimes(count, startMs, endMs) {
    const length = Number(count);
    const start = Number(startMs);
    const end = Number(endMs);
    if (!Number.isInteger(length) || length < 2 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
    }
    const span = end - start;
    return Array.from({ length }, (_, index) => start + ((span * index) / (length - 1)));
}
