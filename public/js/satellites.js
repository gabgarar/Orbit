import { SatelliteWebSocket } from "./SatelliteWebSocket.js";

let satelliteEntities = {};

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

function updateSatellite(viewer, satData) {

    const id = satData.satellite || "UNKNOWN";
    const pos = satData.position;

    const cart = new Cesium.Cartesian3(pos.x, pos.y, pos.z);

    if (!satelliteEntities[id]) {

        satelliteEntities[id] = viewer.entities.add({
            id: id,
            position: cart,
            point: {
                pixelSize: 10,
                color: Cesium.Color.YELLOW
            },
            label: {
                text: id,
                font: "14px sans-serif",
                fillColor: Cesium.Color.WHITE,
                pixelOffset: new Cesium.Cartesian2(0, -20)
            }
        });

    } else {
        satelliteEntities[id].position = cart;
    }
}
