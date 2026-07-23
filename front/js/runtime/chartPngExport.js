function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

export function chartPngFilename(chartId) {
    const safeChartId = String(chartId || "parameter")
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "parameter";
    return "orbit-" + safeChartId + "-chart.png";
}

/**
 * Rasterize an SVG chart and trigger a local PNG download.  Browser APIs are
 * injectable so the export contract can be tested without a DOM implementation.
 */
export function downloadChartPng(svg, chartId, {
    windowRef = globalThis.window,
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    BlobCtor = globalThis.Blob,
    ImageCtor = globalThis.Image,
    XMLSerializerCtor = globalThis.XMLSerializer
} = {}) {
    if (!svg || !windowRef || !documentRef || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL || !BlobCtor || !ImageCtor || !XMLSerializerCtor) return;

    const viewBox = svg.viewBox?.baseVal;
    const bounds = svg.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || viewBox?.width || 820));
    const height = Math.max(1, Math.round(bounds.height || viewBox?.height || 350));
    const pixelRatio = clamp(windowRef.devicePixelRatio || 1, 1, 2);
    const clonedSvg = svg.cloneNode(true);
    const namespace = "http://www.w3.org/2000/svg";
    const background = documentRef.createElementNS(namespace, "rect");
    const computedStyle = typeof windowRef.getComputedStyle === "function" ? windowRef.getComputedStyle(svg) : null;

    background.setAttribute("width", "100%");
    background.setAttribute("height", "100%");
    background.setAttribute("fill", "#071321");
    clonedSvg.insertBefore(background, clonedSvg.firstChild);
    clonedSvg.setAttribute("xmlns", namespace);
    clonedSvg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clonedSvg.setAttribute("width", String(width));
    clonedSvg.setAttribute("height", String(height));
    if (!clonedSvg.getAttribute("viewBox")) clonedSvg.setAttribute("viewBox", "0 0 " + width + " " + height);
    if (computedStyle?.fontFamily) clonedSvg.setAttribute("font-family", computedStyle.fontFamily);

    const svgBlob = new BlobCtor([new XMLSerializerCtor().serializeToString(clonedSvg)], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = urlApi.createObjectURL(svgBlob);
    const image = new ImageCtor();
    const download = (blob) => {
        if (!blob) return;
        const pngUrl = urlApi.createObjectURL(blob);
        const anchor = documentRef.createElement("a");
        anchor.href = pngUrl;
        anchor.download = chartPngFilename(chartId);
        documentRef.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        windowRef.setTimeout(() => urlApi.revokeObjectURL(pngUrl), 0);
    };

    image.onload = () => {
        urlApi.revokeObjectURL(svgUrl);
        const canvas = documentRef.createElement("canvas");
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        const context = canvas.getContext("2d");
        if (!context) return;
        context.scale(pixelRatio, pixelRatio);
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob(download, "image/png");
    };
    image.onerror = () => urlApi.revokeObjectURL(svgUrl);
    image.src = svgUrl;
}
