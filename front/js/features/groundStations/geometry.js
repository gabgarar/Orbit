/** Pure ground-station calculations. */

export function calculateElevationDegrees(Cesium, stationCartesian, satelliteCartesian) {
    const lineOfSight = Cesium.Cartesian3.subtract(
        satelliteCartesian,
        stationCartesian,
        new Cesium.Cartesian3()
    );
    const normalizedLineOfSight = Cesium.Cartesian3.normalize(lineOfSight, new Cesium.Cartesian3());
    // The visibility service on the backend uses the WGS-84 geodetic ENU
    // frame. At non-equatorial latitudes the radial vector is not the local
    // ellipsoid normal, so use Cesium's matching surface normal here rather
    // than an Earth-centre approximation.
    const zenith = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
        stationCartesian,
        new Cesium.Cartesian3()
    );
    const dot = Cesium.Math.clamp(Cesium.Cartesian3.dot(normalizedLineOfSight, zenith), -1, 1);
    return Cesium.Math.toDegrees(Math.asin(dot));
}

/**
 * Return the target azimuth clockwise from geodetic north, in degrees.
 * The local ENU construction intentionally mirrors the Python AOS/LOS
 * service, so mechanical limits are evaluated in the same terrestrial frame.
 */
export function calculateAzimuthDegrees(Cesium, stationCartesian, satelliteCartesian) {
    const station = Cesium.Cartographic.fromCartesian(stationCartesian, Cesium.Ellipsoid.WGS84);
    if (!station) return null;
    const delta = Cesium.Cartesian3.subtract(satelliteCartesian, stationCartesian, new Cesium.Cartesian3());
    const latitude = station.latitude;
    const longitude = station.longitude;
    const east = (-Math.sin(longitude) * delta.x) + (Math.cos(longitude) * delta.y);
    const north = (-Math.sin(latitude) * Math.cos(longitude) * delta.x)
        - (Math.sin(latitude) * Math.sin(longitude) * delta.y)
        + (Math.cos(latitude) * delta.z);
    const azimuth = Cesium.Math.toDegrees(Math.atan2(east, north));
    return ((azimuth + 180) % 360 + 360) % 360 - 180;
}

export function calculateFreeSpacePathLossDb(frequencyMhz, rangeKm) {
    if (!Number.isFinite(frequencyMhz) || frequencyMhz <= 0 || !Number.isFinite(rangeKm) || rangeKm <= 0) {
        return null;
    }
    return 32.45 + (20 * Math.log10(frequencyMhz)) + (20 * Math.log10(rangeKm));
}

export function calculateGeoDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
    const toRadians = (degrees) => degrees * (Math.PI / 180);
    const deltaLatitude = toRadians(Number(latitudeB) - Number(latitudeA));
    const deltaLongitude = toRadians(Number(longitudeB) - Number(longitudeA));
    const latitudeARadians = toRadians(Number(latitudeA));
    const latitudeBRadians = toRadians(Number(latitudeB));
    const haversine = (Math.sin(deltaLatitude / 2) ** 2)
        + (Math.cos(latitudeARadians) * Math.cos(latitudeBRadians) * (Math.sin(deltaLongitude / 2) ** 2));
    const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
    return 6371 * centralAngle;
}
