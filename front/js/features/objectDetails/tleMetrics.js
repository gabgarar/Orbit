const EARTH_RADIUS_KM = 6378.137;
const EARTH_MU_KM3_S2 = 398600.4418;
const SECONDS_PER_DAY = 86400;

function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function getTleChecksum(line) {
    const text = String(line || "");
    if (text.length < 69 || !/\d/.test(text.charAt(68))) return null;

    const computed = [...text.slice(0, 68)].reduce((sum, character) => {
        if (/\d/.test(character)) return sum + Number(character);
        return sum + (character === "-" ? 1 : 0);
    }, 0) % 10;
    const expected = Number(text.charAt(68));
    return { expected, computed, valid: expected === computed };
}

export function deriveTleOrbitalMetrics(tleSummary) {
    const meanMotionRevDay = finite(tleSummary?.meanMotionRevDay);
    const eccentricity = finite(tleSummary?.eccentricity);
    const meanMotionRadSec = meanMotionRevDay && meanMotionRevDay > 0
        ? meanMotionRevDay * (2 * Math.PI) / SECONDS_PER_DAY
        : null;
    const periodMinutes = meanMotionRevDay && meanMotionRevDay > 0
        ? SECONDS_PER_DAY / meanMotionRevDay / 60
        : null;
    const semiMajorAxisKm = meanMotionRadSec
        ? Math.cbrt(EARTH_MU_KM3_S2 / (meanMotionRadSec * meanMotionRadSec))
        : null;
    const hasEllipticShape = semiMajorAxisKm !== null && eccentricity !== null && eccentricity >= 0 && eccentricity < 1;

    return {
        meanMotionRevDay,
        meanMotionRadSec,
        periodMinutes,
        semiMajorAxisKm,
        perigeeKm: hasEllipticShape ? semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM : null,
        apogeeKm: hasEllipticShape ? semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM : null,
        revolutionNumberAtEpoch: String(tleSummary?.revolutionNumberAtEpoch || "").trim() || null,
        line1Checksum: getTleChecksum(tleSummary?.line1),
        line2Checksum: getTleChecksum(tleSummary?.line2)
    };
}
