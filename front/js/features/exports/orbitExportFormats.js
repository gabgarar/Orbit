/**
 * Product-facing orbital export catalogue.
 *
 * Keep availability and explanatory copy in one plain-JS module so the React
 * dialog, the legacy download bridge and unit tests cannot disagree about a
 * source-only product versus a sampled ephemeris product.
 */

const SAMPLED_FORMATS = Object.freeze([
    {
        id: "csv",
        label: "CSV",
        extension: ".csv",
        title: "Tabla de efem\u00e9rides",
        description: "Muestras cartesianas con \u00e9poca, posici\u00f3n, velocidad, formato de origen y propagador.",
        note: "\u00datil para hojas de c\u00e1lculo y an\u00e1lisis num\u00e9rico. Conserva el marco declarado de las muestras; no es una geometr\u00eda GIS."
    },
    {
        id: "json",
        label: "JSON",
        extension: ".json",
        title: "Efem\u00e9ride estructurada",
        description: "Entrega la respuesta de efem\u00e9rides de Orbit con sus muestras y metadatos de propagaci\u00f3n.",
        note: "Adecuado para integrar herramientas que consumen el contrato de Orbit. No equivale al archivo de entrada original."
    },
    {
        id: "oem",
        label: "CCSDS OEM",
        extension: ".oem",
        title: "Intercambio de efem\u00e9rides",
        description: "Genera una efem\u00e9ride CCSDS OEM a partir de las muestras del intervalo solicitado.",
        note: "Conserva el marco y la escala temporal declarados por las muestras. Es una salida muestreada, no un OEM de alta fidelidad de origen."
    },
    {
        id: "geojson",
        label: "GeoJSON (LineString)",
        extension: ".geojson",
        title: "Ground track web 2D",
        description: "Exporta una o varias LineString WGS-84 de longitud/latitud para visualizaci\u00f3n y GIS web.",
        note: "Solo contiene la proyecci\u00f3n terrestre 2D; la altitud no forma parte de la geometr\u00eda GeoJSON. Un cruce del antimeridiano se divide en segmentos para no dibujar una cuerda mundial falsa."
    },
    {
        id: "kml",
        label: "KML",
        extension: ".kml",
        title: "Trayectoria muestreada 3D",
        description: "Genera LineString con la altitud de cada muestra para Google Earth y visores KML.",
        note: "Representa \u00fanicamente las muestras exportadas, no una trayectoria continua ni una predicci\u00f3n fuera del intervalo. Los cruces del antimeridiano se separan en segmentos. Google Maps aplana KML sobre la superficie."
    },
    {
        id: "kmz",
        label: "KMZ",
        extension: ".kmz",
        title: "KML comprimido",
        description: "Empaqueta la misma trayectoria 3D muestreada y segmentada en un archivo KMZ compacto.",
        note: "Es id\u00f3neo para compartir en Google Earth. Mantiene la limitaci\u00f3n de muestreo del KML incluido y separa los cruces del antimeridiano."
    },
    {
        id: "gpkg",
        label: "GeoPackage (GPKG)",
        extension: ".gpkg",
        title: "GIS profesional",
        description: "Crea una base GeoPackage con LineString Z WGS-84 y atributos de origen, propagador e intervalo.",
        note: "Recomendado para QGIS, ArcGIS y an\u00e1lisis t\u00e9cnico. La geometr\u00eda es la trayectoria muestreada, no una \u00f3rbita anal\u00edtica continua; los cruces del antimeridiano se guardan como segmentos."
    },
    {
        id: "wkt",
        label: "WKT (LineString)",
        extension: ".wkt",
        title: "Geometr\u00eda textual para bases espaciales",
        description: "Exporta la proyecci\u00f3n terrestre como LINESTRING WGS-84 en Well-Known Text.",
        note: "\u00datil en SQL/PostGIS. WKT conserva la geometr\u00eda 2D, no los atributos orbitales ni la altitud; un cruce del antimeridiano se emite como segmentos en GEOMETRYCOLLECTION."
    },
    {
        id: "wkb",
        label: "WKB (LineString)",
        extension: ".wkb",
        title: "Geometr\u00eda binaria",
        description: "Exporta la misma LineString WGS-84 2D en Well-Known Binary.",
        note: "Pensado para bases de datos y APIs espaciales. Los atributos y la altitud no se incluyen en el blob WKB; un cruce del antimeridiano se emite como segmentos en GEOMETRYCOLLECTION."
    }
]);

const SOURCE_FORMATS = Object.freeze({
    tle: {
        id: "tle",
        label: "TLE",
        extension: ".tle",
        title: "TLE de origen",
        description: "Descarga exactamente las dos l\u00edneas TLE importadas para esta capa de cat\u00e1logo.",
        note: "Solo se habilita cuando la fuente real es TLE. No recalcula elementos ni fabrica un TLE desde estados cartesianos."
    },
    syntheticTle: {
        id: "tle-synthetic",
        label: "TLE sint\u00e9tico",
        extension: ".tle",
        title: "Ajuste SGP4 pendiente",
        description: "Un TLE sint\u00e9tico requerir\u00eda ajustar SGP4 a una trayectoria manual y publicar residuos de calidad.",
        note: "Orbit no implementa ese ajuste todav\u00eda. La opci\u00f3n se muestra para hacer expl\u00edcito el l\u00edmite y no genera un TLE f\u00edsicamente enga\u00f1oso.",
        disabled: true
    },
    ommJson: {
        id: "omm-json",
        label: "OMM JSON derivado",
        extension: ".omm.json",
        title: "OMM derivado desde la entrada catalogada",
        description: "Genera un perfil reducido derivado desde los campos OMM que Orbit conserva en la entrada catalogada.",
        note: "No es una copia byte a byte ni un perfil CCSDS OMM completo: valide sus campos antes de usarlo con otro sistema."
    },
    ommXml: {
        id: "omm-xml",
        label: "OMM XML derivado",
        extension: ".omm.xml",
        title: "OMM derivado desde la entrada catalogada",
        description: "Genera un perfil reducido derivado desde los campos OMM que Orbit conserva en la entrada catalogada.",
        note: "No es una copia byte a byte ni un perfil CCSDS OMM completo: valide sus campos antes de usarlo con otro sistema."
    },
    sourceOem: {
        id: "source-oem",
        label: "Perfil OEM derivado (no disponible)",
        extension: ".oem",
        title: "OEM de origen no reexportable todav\u00eda",
        description: "La importaci\u00f3n actual solo conserva un perfil reducido derivado de la entrada catalogada, no el OEM ni sus muestras originales.",
        note: "El perfil derivado heredado no equivale a un OEM de efem\u00e9rides y permanece deshabilitado. Conserve el OEM original; la reexportaci\u00f3n se habilitar\u00e1 con un adaptador que preserve muestras, marco, escala temporal y metadatos.",
        disabled: true
    }
});

function unavailableOemSampledFormats() {
    return SAMPLED_FORMATS.map((format) => ({
        ...format,
        disabled: true,
        title: `${format.title}: pendiente para OEM`,
        description: "La entrada OEM fue catalogada, pero Orbit no conserva sus muestras originales ni las reprocesa mediante SGP4 para generar este producto.",
        note: "La exportacion GIS o de efemerides muestreadas desde OEM se habilitara cuando el adaptador conserve sus muestras, marco y escala temporal sin relabelarlas."
    }));
}

function unavailableUnsupportedSourceFormats(source) {
    return SAMPLED_FORMATS.map((format) => ({
        ...format,
        disabled: true,
        title: `${format.title}: pendiente para ${source}`,
        description: `Orbit no dispone todavia de una ruta de exportacion muestreada y trazable para una entrada ${source}.`,
        note: "La opcion permanece visible para no prometer una conversion de marco, escala temporal o motor que el runtime actual no ejecuta."
    }));
}

function normalizeSourceFormat(value) {
    return String(value || "TLE").trim().toUpperCase();
}

export function getOrbitExportFormats(sourceFormat) {
    const source = normalizeSourceFormat(sourceFormat);
    if (!new Set(["TLE", "OMM", "OEM", "MANUAL"]).has(source)) {
        return unavailableUnsupportedSourceFormats(source);
    }
    const sourceFormats = source === "TLE"
        ? [SOURCE_FORMATS.tle]
        : source === "MANUAL"
            ? [SOURCE_FORMATS.syntheticTle]
            : source === "OMM"
                ? [SOURCE_FORMATS.ommJson, SOURCE_FORMATS.ommXml]
                : source === "OEM"
                    ? [SOURCE_FORMATS.sourceOem, ...unavailableOemSampledFormats()]
                    : [];
    // OEM imports are rendered from their native sampled track in the
    // browser.  That track is not yet exposed as a lossless exporter, so do
    // not relabel it as an SGP4 propagation simply to make these options run.
    return source === "OEM" ? sourceFormats : [...sourceFormats, ...SAMPLED_FORMATS];
}

export function getOrbitExportFormat(sourceFormat, id) {
    const formats = getOrbitExportFormats(sourceFormat);
    return formats.find((format) => format.id === id) || formats.find((format) => !format.disabled) || formats[0];
}

export function getDefaultOrbitExportFormat(sourceFormat) {
    return getOrbitExportFormats(sourceFormat).find((format) => !format.disabled)?.id || "csv";
}

export function isSourceOnlyOrbitExport(formatId) {
    return ["tle", "omm-json", "omm-xml", "source-oem", "tle-synthetic"].includes(String(formatId || ""));
}
