import { SatelliteWebSocket } from "./SatelliteWebSocket.js";

let satelliteEntities = {};
let satelliteState = {};
let orbitConfig = {
    show_orbits: true,
    orbit_future_line_width: 3,
    orbit_future_color: "#00ff88",
    orbit_past_color: "#ff0000",
    orbit_past_samples: 120,
    orbit_past_line_width: 5
};

export function setOrbitConfig(config) {
    orbitConfig = {
        ...orbitConfig,
        ...config
    };
}

export function initSatelliteReceiver(viewer) {
    const ws = new SatelliteWebSocket((data) => {
        if (Array.isArray(data)) {
            data.forEach(s => updateSatellite(viewer, s));
        } else {
            updateSatellite(viewer, data);
        }
    });

    ws.connect();
}

function calculateOrientation(position, velocity) {
    /**
     * Calcula la orientación (quaternión) del satélite basado en posición y velocidad
     * Usa un sistema de referencia orbital (SRF):
     * - Z apunta hacia el centro de la Tierra (posición negativa)
     * - X apunta en la dirección del movimiento (velocidad)
     * - Y es el producto cruzado
     */
    
    const posVec = new Cesium.Cartesian3(position.x, position.y, position.z);
    const velVec = new Cesium.Cartesian3(velocity.x, velocity.y, velocity.z);
    
    const zAxis = Cesium.Cartesian3.normalize(Cesium.Cartesian3.negate(posVec, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const xAxis = Cesium.Cartesian3.normalize(velVec, new Cesium.Cartesian3());
    
    const yAxis = Cesium.Cartesian3.cross(zAxis, xAxis, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(yAxis, yAxis);
    
    const xAxisFinal = Cesium.Cartesian3.cross(yAxis, zAxis, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(xAxisFinal, xAxisFinal);
    
    const matrix = new Cesium.Matrix3(
        xAxisFinal.x, yAxis.x, zAxis.x,
        xAxisFinal.y, yAxis.y, zAxis.y,
        xAxisFinal.z, yAxis.z, zAxis.z
    );
    
    return Cesium.Quaternion.fromRotationMatrix(matrix);
}

function toCartesianArray(points) {
    return points.map((position) => new Cesium.Cartesian3(position.x, position.y, position.z));
}

function getColor(colorString, defaultColor) {
    try {
        return Cesium.Color.fromCssColorString(colorString || defaultColor);
    } catch (e) {
        return Cesium.Color.fromCssColorString(defaultColor);
    }
}

function createOrbitEntity(viewer, id, positions, color, width) {
    return viewer.entities.add({
        id: `${id}-orbit`,
        polyline: {
            positions,
            width,
            material: new Cesium.ColorMaterialProperty(color),
            clampToGround: false
        }
    });
}

function createTrailEntity(viewer, id, positions, color, width) {
    return viewer.entities.add({
        id: `${id}-trail`,
        polyline: {
            positions,
            width,
            material: new Cesium.ColorMaterialProperty(color),
            clampToGround: false
        }
    });
}

function ensureSatelliteState(viewer, id, cart, orientation) {
    if (!satelliteState[id]) {
        const entity = viewer.entities.add({
            id: id,
            position: cart,
            orientation: orientation,
            scale: 1500,
            model: {
                uri: "/models/satelliteModel.glb",
                minimumPixelSize: 1000,
                maximumScale: 5000
            },
            label: {
                text: id,
                font: "14px sans-serif",
                fillColor: Cesium.Color.WHITE,
                pixelOffset: new Cesium.Cartesian2(0, -30),
                show: true
            }
        });

        satelliteState[id] = {
            entity,
            trailPositions: [cart],
            trailEntity: null,
            orbitEntity: null
        };
        satelliteEntities[id] = entity;
        console.log(`📡 Creando satélite: ${id}`);
        return satelliteState[id];
    }

    const state = satelliteState[id];
    state.trailPositions.push(cart);
    if (state.trailPositions.length > orbitConfig.orbit_past_samples) {
        state.trailPositions.shift();
    }
    return state;
}

function updateSatellite(viewer, satData) {
    const id = satData.satellite || "UNKNOWN";
    const pos = satData.position;
    const vel = satData.velocity || { x: 0, y: 0, z: 0 };

    const cart = new Cesium.Cartesian3(pos.x, pos.y, pos.z);
    const orientation = calculateOrientation(pos, vel);

    const state = ensureSatelliteState(viewer, id, cart, orientation);

    state.entity.position = cart;
    state.entity.orientation = orientation;

    if (orbitConfig.show_orbits && Array.isArray(satData.orbit) && satData.orbit.length > 1) {
        const orbitPositions = toCartesianArray(satData.orbit);
        const futureColor = getColor(orbitConfig.orbit_future_color, "#00ff88");

        if (!state.orbitEntity) {
            state.orbitEntity = createOrbitEntity(
                viewer,
                id,
                orbitPositions,
                futureColor,
                orbitConfig.orbit_future_line_width
            );
        } else {
            state.orbitEntity.polyline.positions = orbitPositions;
            state.orbitEntity.polyline.material = new Cesium.ColorMaterialProperty(futureColor);
            state.orbitEntity.polyline.width = orbitConfig.orbit_future_line_width;
        }
    }

    if (state.trailPositions.length > 1) {
        const trailColor = getColor(orbitConfig.orbit_past_color, "#ff0000");
        if (!state.trailEntity) {
            state.trailEntity = createTrailEntity(
                viewer,
                id,
                state.trailPositions,
                trailColor,
                orbitConfig.orbit_past_line_width
            );
        } else {
            state.trailEntity.polyline.positions = state.trailPositions;
            state.trailEntity.polyline.material = new Cesium.ColorMaterialProperty(trailColor);
            state.trailEntity.polyline.width = orbitConfig.orbit_past_line_width;
        }
    }
}
