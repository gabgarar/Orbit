import {
    calculateDirectionalPatternOffsetsDeg,
    calculatePatternGainDbi,
    calculateStationRfModel
} from "./rfModel.js";

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function normalizeAzimuth(value) {
    return ((value + 180) % 360 + 360) % 360 - 180;
}

function azimuthSweep(minimumDeg, maximumDeg) {
    const authoredMinimum = finiteNumber(minimumDeg, -180);
    const authoredMaximum = finiteNumber(maximumDeg, 180);
    const minimum = normalizeAzimuth(authoredMinimum);
    const maximum = normalizeAzimuth(authoredMaximum);
    // Equal limits mean a full rotation in the station contract. Preserve the
    // authored -180…180 full travel too, although both values normalize to
    // -180 mathematically.
    if (Math.abs(authoredMaximum - authoredMinimum) < 1e-9 || Math.abs(authoredMaximum - authoredMinimum) >= 359.999) {
        return { start_deg: minimum, span_deg: 360, full: true };
    }
    return { start_deg: minimum, span_deg: (maximum - minimum + 360) % 360, full: false };
}

/**
 * Convert a local horizon direction to an ENU unit vector. Azimuth is
 * clockwise from north and elevation is above the geometric horizon.
 */
export function localHorizonDirection(azimuthDeg, elevationDeg) {
    const azimuth = finiteNumber(azimuthDeg, 0) * Math.PI / 180;
    const elevation = finiteNumber(elevationDeg, 0) * Math.PI / 180;
    const horizontal = Math.cos(elevation);
    return {
        east: horizontal * Math.sin(azimuth),
        north: horizontal * Math.cos(azimuth),
        up: Math.sin(elevation)
    };
}

/**
 * Build a closed, low-density directional RF volume in station-local ENU
 * coordinates.
 *
 * It is a link-budget surface rather than a decorative cone: the radius at
 * each off-axis direction is scaled by 10^((G - Gmax)/20), which follows the
 * free-space range law. Consumers convert the local positions to their own
 * renderer coordinate system. A 48 × 12 default is intentionally restrained
 * so several station lobes remain cheap in an operational scene.
 */
export function buildStationPatternMesh(station, {
    maxRangeKm = null,
    azimuthSamples = 48,
    radialSamples = 12,
    elevationSamples = null
} = {}) {
    const model = calculateStationRfModel(station);
    const baseRangeKm = Number.isFinite(Number(maxRangeKm)) && Number(maxRangeKm) > 0
        ? Number(maxRangeKm)
        : model.visual_range_km;
    if (!Number.isFinite(baseRangeKm) || baseRangeKm <= 0 || !Number.isFinite(model.tx_effective_gain_dbi)) {
        return { model, positions_enu_m: [], indices: [], valid: false, reason: "range-or-gain-unavailable" };
    }

    // A stationary antenna is still sensitive outside its -3 dB contour.
    // Rather than drawing a decorative cone and silently rejecting the rest,
    // sample the entire mechanically reachable sky and scale each direction
    // by its directional link range. This uses the same gain floor as the
    // planner/AOS-LOS contract.
    const minElevationDeg = Math.max(model.min_elevation_deg, model.mechanical_elevation_min_deg);
    const maxElevationDeg = model.mechanical_elevation_max_deg;
    if (maxElevationDeg <= minElevationDeg) {
        return { model, positions_enu_m: [], indices: [], valid: false, reason: "elevation-envelope-unavailable" };
    }
    const sweep = azimuthSweep(
        model.mechanical_azimuth_min_deg,
        model.mechanical_azimuth_max_deg
    );
    const requestedAzimuths = clamp(Math.floor(finiteNumber(azimuthSamples, 48)), 12, 96);
    const requestedElevations = clamp(Math.floor(finiteNumber(elevationSamples ?? radialSamples, 12)), 3, 32);
    const azimuthCount = sweep.full
        ? requestedAzimuths
        : Math.max(2, Math.round((requestedAzimuths * sweep.span_deg) / 360) + 1);
    const elevationCount = requestedElevations + 1;
    const positions = [];
    const indices = [];
    positions.push(0, 0, 0);
    const sideLobeFloorRatio = 10 ** (-model.side_lobe_level_db / 20);

    const indexAt = (elevationIndex, azimuthIndex) => 1 + (elevationIndex * azimuthCount) + azimuthIndex;
    for (let elevationIndex = 0; elevationIndex < elevationCount; elevationIndex += 1) {
        const elevationDeg = minElevationDeg + (((maxElevationDeg - minElevationDeg) * elevationIndex) / (elevationCount - 1));
        for (let azimuthIndex = 0; azimuthIndex < azimuthCount; azimuthIndex += 1) {
            const fraction = sweep.full
                ? azimuthIndex / azimuthCount
                : azimuthIndex / (azimuthCount - 1);
            const azimuthDeg = normalizeAzimuth(sweep.start_deg + (sweep.span_deg * fraction));
            const patternOffsets = calculateDirectionalPatternOffsetsDeg(
                azimuthDeg,
                elevationDeg,
                model.boresight_azimuth_deg,
                model.boresight_elevation_deg
            );
            const gainDbi = calculatePatternGainDbi({
                peakGainDbi: model.tx_effective_gain_dbi,
                patternType: model.pattern_type,
                hpbwAzimuthDeg: model.hpbw_azimuth_deg,
                hpbwElevationDeg: model.hpbw_elevation_deg,
                sideLobeLevelDb: model.side_lobe_level_db,
                azimuthOffsetDeg: patternOffsets.azimuth_offset_deg,
                elevationOffsetDeg: patternOffsets.elevation_offset_deg
            });
            const rangeRatio = gainDbi === null
                ? sideLobeFloorRatio
                : Math.max(sideLobeFloorRatio, 10 ** ((gainDbi - model.tx_effective_gain_dbi) / 20));
            const direction = localHorizonDirection(azimuthDeg, elevationDeg);
            const rangeM = baseRangeKm * 1000 * rangeRatio;
            positions.push(direction.east * rangeM, direction.north * rangeM, direction.up * rangeM);
        }
    }

    const columnLimit = sweep.full ? azimuthCount : azimuthCount - 1;
    for (let elevationIndex = 0; elevationIndex < elevationCount - 1; elevationIndex += 1) {
        for (let azimuthIndex = 0; azimuthIndex < columnLimit; azimuthIndex += 1) {
            const nextAzimuth = (azimuthIndex + 1) % azimuthCount;
            const lowerLeft = indexAt(elevationIndex, azimuthIndex);
            const lowerRight = indexAt(elevationIndex, nextAzimuth);
            const upperLeft = indexAt(elevationIndex + 1, azimuthIndex);
            const upperRight = indexAt(elevationIndex + 1, nextAzimuth);
            indices.push(
                lowerLeft,
                upperLeft,
                upperRight,
                lowerLeft,
                upperRight,
                lowerRight
            );
        }
    }
    // Close both elevation boundaries to the station apex, then cap the two
    // azimuth walls when the mount does not make a full turn. This yields a
    // genuine lightweight volume while remaining inside every mount stop.
    for (let azimuthIndex = 0; azimuthIndex < columnLimit; azimuthIndex += 1) {
        const nextAzimuth = (azimuthIndex + 1) % azimuthCount;
        indices.push(0, indexAt(0, nextAzimuth), indexAt(0, azimuthIndex));
        indices.push(0, indexAt(elevationCount - 1, azimuthIndex), indexAt(elevationCount - 1, nextAzimuth));
    }
    if (!sweep.full) {
        for (let elevationIndex = 0; elevationIndex < elevationCount - 1; elevationIndex += 1) {
            indices.push(0, indexAt(elevationIndex, 0), indexAt(elevationIndex + 1, 0));
            indices.push(0, indexAt(elevationIndex + 1, azimuthCount - 1), indexAt(elevationIndex, azimuthCount - 1));
        }
    }

    return {
        model,
        valid: true,
        coordinate_system: "ENU",
        kind: "directional-pattern",
        base_range_km: baseRangeKm,
        azimuth_start_deg: sweep.start_deg,
        azimuth_span_deg: sweep.span_deg,
        min_elevation_deg: minElevationDeg,
        max_elevation_deg: maxElevationDeg,
        azimuth_samples: azimuthCount,
        radial_samples: requestedElevations,
        positions_enu_m: positions,
        indices
    };
}

/**
 * Build the mechanically reachable field of regard for tracking or scan.
 *
 * There is no individual boresight in those modes, so a directional gain
 * lobe would claim an instantaneous pointing state that does not exist. The
 * mesh instead shows the actual azimuth/elevation envelope bounded by the
 * elevation mask and the mount stops. It intentionally has constant visual
 * radius; RF range remains a separate access gate.
 */
export function buildStationFieldOfRegardMesh(station, {
    maxRangeKm = null,
    azimuthSamples = 48,
    elevationSamples = 12
} = {}) {
    const model = calculateStationRfModel(station);
    const baseRangeKm = Number.isFinite(Number(maxRangeKm)) && Number(maxRangeKm) > 0
        ? Number(maxRangeKm)
        : model.visual_range_km;
    const minElevationDeg = Math.max(model.min_elevation_deg, model.mechanical_elevation_min_deg);
    const maxElevationDeg = model.mechanical_elevation_max_deg;
    if (!Number.isFinite(baseRangeKm) || baseRangeKm <= 0 || maxElevationDeg <= minElevationDeg) {
        return { model, positions_enu_m: [], indices: [], valid: false, reason: "range-or-elevation-envelope-unavailable" };
    }

    const sweep = azimuthSweep(model.mechanical_azimuth_min_deg, model.mechanical_azimuth_max_deg);
    const requestedAzimuths = clamp(Math.floor(finiteNumber(azimuthSamples, 48)), 12, 96);
    const requestedElevations = clamp(Math.floor(finiteNumber(elevationSamples, 12)), 3, 32);
    const azimuthCount = sweep.full
        ? requestedAzimuths
        : Math.max(2, Math.round((requestedAzimuths * sweep.span_deg) / 360) + 1);
    const elevationCount = requestedElevations + 1;
    const positions = [0, 0, 0];
    const indices = [];
    const indexAt = (elevationIndex, azimuthIndex) => 1 + (elevationIndex * azimuthCount) + azimuthIndex;

    for (let elevationIndex = 0; elevationIndex < elevationCount; elevationIndex += 1) {
        const elevationDeg = minElevationDeg + (((maxElevationDeg - minElevationDeg) * elevationIndex) / (elevationCount - 1));
        for (let azimuthIndex = 0; azimuthIndex < azimuthCount; azimuthIndex += 1) {
            const fraction = sweep.full
                ? azimuthIndex / azimuthCount
                : azimuthIndex / (azimuthCount - 1);
            const azimuthDeg = normalizeAzimuth(sweep.start_deg + (sweep.span_deg * fraction));
            const direction = localHorizonDirection(azimuthDeg, elevationDeg);
            const rangeM = baseRangeKm * 1000;
            positions.push(direction.east * rangeM, direction.north * rangeM, direction.up * rangeM);
        }
    }

    const columnLimit = sweep.full ? azimuthCount : azimuthCount - 1;
    for (let elevationIndex = 0; elevationIndex < elevationCount - 1; elevationIndex += 1) {
        for (let azimuthIndex = 0; azimuthIndex < columnLimit; azimuthIndex += 1) {
            const nextAzimuth = (azimuthIndex + 1) % azimuthCount;
            const lowerLeft = indexAt(elevationIndex, azimuthIndex);
            const lowerRight = indexAt(elevationIndex, nextAzimuth);
            const upperLeft = indexAt(elevationIndex + 1, azimuthIndex);
            const upperRight = indexAt(elevationIndex + 1, nextAzimuth);
            indices.push(lowerLeft, upperLeft, upperRight, lowerLeft, upperRight, lowerRight);
        }
    }

    // Close the volume to the station apex. This gives a lightweight but
    // unambiguous mechanical sector rather than a floating spherical patch.
    for (let azimuthIndex = 0; azimuthIndex < columnLimit; azimuthIndex += 1) {
        const nextAzimuth = (azimuthIndex + 1) % azimuthCount;
        indices.push(0, indexAt(0, nextAzimuth), indexAt(0, azimuthIndex));
        indices.push(0, indexAt(elevationCount - 1, azimuthIndex), indexAt(elevationCount - 1, nextAzimuth));
    }
    if (!sweep.full) {
        for (let elevationIndex = 0; elevationIndex < elevationCount - 1; elevationIndex += 1) {
            indices.push(0, indexAt(elevationIndex, 0), indexAt(elevationIndex + 1, 0));
            indices.push(0, indexAt(elevationIndex + 1, azimuthCount - 1), indexAt(elevationIndex, azimuthCount - 1));
        }
    }

    return {
        model,
        valid: true,
        coordinate_system: "ENU",
        kind: "mechanical-field-of-regard",
        base_range_km: baseRangeKm,
        azimuth_start_deg: sweep.start_deg,
        azimuth_span_deg: sweep.span_deg,
        min_elevation_deg: minElevationDeg,
        max_elevation_deg: maxElevationDeg,
        azimuth_samples: azimuthCount,
        elevation_samples: elevationCount,
        positions_enu_m: positions,
        indices
    };
}
