export function parseTleEpochDate(line1) {
    const raw = String(line1 || "");
    if (raw.length < 32) return null;
    const yy = Number.parseInt(raw.slice(18, 20), 10);
    const dayOfYear = Number.parseFloat(raw.slice(20, 32));
    if (!Number.isFinite(yy) || !Number.isFinite(dayOfYear) || dayOfYear <= 0) return null;
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const epochDate = new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 24 * 60 * 60 * 1000);
    return Number.isNaN(epochDate.getTime()) ? null : epochDate;
}

export function formatDurationCompact(msDiff) {
    if (!Number.isFinite(msDiff)) return "--";
    const sign = msDiff >= 0 ? "+" : "-";
    const totalSeconds = Math.floor(Math.abs(msDiff) / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (days > 0) return `${sign}${days}d ${hours}h`;
    if (hours > 0) return `${sign}${hours}h ${minutes}m`;
    if (minutes > 0) return `${sign}${minutes}m ${seconds}s`;
    return `${sign}${seconds}s`;
}
