/** Canvas symbols used by ground-station Cesium billboards. */

export function createGroundStationSymbol(symbol = "circle", color = "#3cc4ff", size = 11) {
    const pixels = Math.max(8, Math.min(64, Math.round(Number(size) || 11)));
    const canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    const context = canvas.getContext("2d");
    if (!context) {
        return "";
    }

    const center = pixels / 2;
    const radius = (pixels / 2) - 1.5;
    context.clearRect(0, 0, pixels, pixels);
    context.fillStyle = String(color || "#3cc4ff");
    context.strokeStyle = "#00131f";
    context.lineWidth = 1.8;

    const drawPolygon = (points) => {
        context.beginPath();
        points.forEach(([x, y], index) => {
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        });
        context.closePath();
        context.fill();
        context.stroke();
    };

    switch (String(symbol || "circle")) {
    case "square":
        drawPolygon([[center - radius, center - radius], [center + radius, center - radius], [center + radius, center + radius], [center - radius, center + radius]]);
        break;
    case "triangle":
        drawPolygon([[center, center - radius], [center + radius, center + radius], [center - radius, center + radius]]);
        break;
    case "diamond":
        drawPolygon([[center, center - radius], [center + radius, center], [center, center + radius], [center - radius, center]]);
        break;
    case "star": {
        const points = Array.from({ length: 10 }, (_, index) => {
            const angle = (-Math.PI / 2) + (index * Math.PI / 5);
            const pointRadius = index % 2 === 0 ? radius : radius * 0.45;
            return [center + Math.cos(angle) * pointRadius, center + Math.sin(angle) * pointRadius];
        });
        drawPolygon(points);
        break;
    }
    default:
        context.beginPath();
        context.arc(center, center, radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();
    }

    return canvas.toDataURL("image/png");
}
