const DAY_MS = 24 * 60 * 60 * 1000;

function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Parse the fixed TLE epoch field (YYDDD.fraction) without allowing Date to
 * silently roll an impossible day into the following year.
 */
export function tleEpochToDate(epoch) {
    const match = /^(\d{2})(\d{3})(?:\.(\d+))?$/.exec(String(epoch ?? "").trim());
    if (!match) return null;

    const shortYear = Number(match[1]);
    const dayOfYear = Number(match[2]);
    const fractionText = match[3] || "";
    const year = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear;
    const daysInYear = isLeapYear(year) ? 366 : 365;
    if (!Number.isInteger(shortYear) || dayOfYear < 1 || dayOfYear > daysInYear) return null;

    const fractionalDay = fractionText ? Number(`0.${fractionText}`) : 0;
    if (!Number.isFinite(fractionalDay) || fractionalDay < 0 || fractionalDay >= 1) return null;

    // Date is millisecond precision. Flooring keeps a near-1 fractional day
    // inside its stated epoch day instead of rounding into the next year.
    const fractionalMs = Math.min(DAY_MS - 1, Math.floor(fractionalDay * DAY_MS));
    const timestamp = Date.UTC(year, 0, 1) + ((dayOfYear - 1) * DAY_MS) + fractionalMs;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function tleEpochAgeMs(epoch, referenceTimeMs = Date.now()) {
    const date = tleEpochToDate(epoch);
    const reference = Number(referenceTimeMs);
    if (!date || !Number.isFinite(reference)) return null;
    return reference - date.getTime();
}
