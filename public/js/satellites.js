import { SatelliteWebSocket } from "./SatelliteWebSocket.js";

let satelliteEntities = {};
let satelliteModels = {};

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
    
    // Vectores como arrays de Cesium.Cartesian3
    const posVec = new Cesium.Cartesian3(position.x, position.y, position.z);
    const velVec = new Cesium.Cartesian3(velocity.x, velocity.y, velocity.z);
    
    // Normalizar
    const zAxis = Cesium.Cartesian3.normalize(Cesium.Cartesian3.negate(posVec, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const xAxis = Cesium.Cartesian3.normalize(velVec, new Cesium.Cartesian3());
    
    // Y es el producto cruzado de Z y X
    const yAxis = Cesium.Cartesian3.cross(zAxis, xAxis, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(yAxis, yAxis);
    
    // Recalcular X para asegurar ortogonalidad
    const xAxisFinal = Cesium.Cartesian3.cross(yAxis, zAxis, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(xAxisFinal, xAxisFinal);
    
    // Crear matriz de rotación 3x3 y convertir a quaternión
    const matrix = new Cesium.Matrix3(
        xAxisFinal.x, yAxis.x, zAxis.x,
        xAxisFinal.y, yAxis.y, zAxis.y,
        xAxisFinal.z, yAxis.z, zAxis.z
    );
    
    const quaternion = Cesium.Quaternion.fromRotationMatrix(matrix);
    return quaternion;
}

async function loadSatelliteModel(id) {
    /**
     * Carga el modelo 3D del satélite
     */
    try {
        const modelPath = "./models/satelliteModel.glb";
        const model = await Cesium.Model.fromGltf({
            url: modelPath,
            modelMatrix: Cesium.Matrix4.IDENTITY
        });
        return model;
    } catch (error) {
        console.error("Error cargando modelo para " + id + ":", error);
        return null;
    }
}

function updateSatellite(viewer, satData) {

    const id = satData.satellite || "UNKNOWN";
    const pos = satData.position;
    const vel = satData.velocity || { x: 0, y: 0, z: 0 };

    const cart = new Cesium.Cartesian3(pos.x, pos.y, pos.z);
    const orientation = calculateOrientation(pos, vel);

    if (!satelliteEntities[id]) {
        console.log(`📡 Creando satélite: ${id} en posición`, cart);
        
        // Crear nueva entidad con el modelo 3D
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

        satelliteEntities[id] = entity;
        console.log(`✅ Satélite ${id} creado`, entity);

    } else {
        // Actualizar posición y orientación
        satelliteEntities[id].position = cart;
        satelliteEntities[id].orientation = orientation;
    }
}
