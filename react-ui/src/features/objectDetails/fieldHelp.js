/**
 * Short, source-aware explanations for the object inspector.
 *
 * Detail rows intentionally keep their `[label, value, tone?]` transport
 * shape so the runtime and the React presenter remain decoupled.  The help
 * vocabulary lives next to that projection instead of leaking presentation
 * strings into propagation or import code.
 */

function normalizedLabel(label) {
    return String(label || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
}

const FIELD_HELP = Object.freeze({
    nombre: "Nombre mostrado para esta capa; puede diferir del identificador técnico del producto.",
    norad: "Número de catálogo NORAD. Los productos GNSS SP3 no llevan necesariamente un número NORAD.",
    cospar: "Designador internacional COSPAR: año de lanzamiento, número de lanzamiento y pieza del objeto.",
    "tipo de entrada": "Formato con el que Orbit recibió los datos. Determina qué campos se pueden interpretar sin inventar información.",
    "epoca de entrada": "Instante de referencia del archivo de entrada. En TLE es la época de los elementos; en productos tabulados se muestra la cobertura.",
    fuente: "Entidad o archivo del que procede la información de esta capa.",
    "estado del objeto": "Estado de visibilidad y operación de la capa dentro del proyecto actual; no es un estado de salud físico del satélite.",
    "fecha de lanzamiento": "Fecha de lanzamiento publicada por la fuente del catálogo, si está disponible.",
    "edad del dato": "Tiempo transcurrido desde la época de entrada frente al tiempo de simulación. No se usa como calidad de un SP3 tabulado.",
    "calidad del dato": "Calificación de la fuente o de la clase de producto. Una efeméride SP3 es un producto preciso, no una predicción SGP4.",
    "tipo de objeto": "Clasificación administrativa publicada por la fuente, por ejemplo satélite, cuerpo de referencia o carga útil.",
    mision: "Misión o finalidad declarada por la fuente del objeto.",
    "operador / agencia": "Organización responsable u originadora publicada para el objeto o producto.",
    pais: "País o código de país publicado por la fuente del catálogo.",
    "ultima actualizacion": "Última fecha de actualización que proporcionó la fuente de entrada.",

    "identificador gnss": "Identificador del miembro GNSS en el producto SP3 (por ejemplo G para GPS, E para Galileo o C para BeiDou). Es la identidad que se importa como capa.",
    constelacion: "Constelación GNSS deducida del prefijo del identificador del satélite; no se infiere de su posición.",
    producto: "Nombre o identificador publicado del producto GNSS del que proceden las efemérides.",
    "id de producto": "Identificador técnico y estable del producto importado. Permite distinguir productos con fechas o proveedores diferentes.",
    proveedor: "Proveedor o centro que publicó el producto preciso, identificado desde los ficheros y sus convenciones de nombre.",
    "clase de producto": "Clase detectada del producto, por ejemplo final, rapid o ultra-rapid. Se deduce de la cabecera y del nombre publicado; no se edita manualmente.",
    "familia de producto": "Familia del producto GNSS, como IGS operacional, MGEX o ESA/NSO, identificada a partir de la procedencia del fichero.",
    "cobertura utc": "Intervalo UTC para el que este producto contiene muestras. Fuera de esa ventana Orbit no extrapola estados SP3.",
    "estado de representacion": "Indica si el estado nativo del producto puede mostrarse de forma fiable en la escena y qué contrato de marco se está aplicando.",

    "instante mostrado": "Tiempo de simulación usado para consultar el estado instantáneo de esta capa.",
    "instante de consulta": "Tiempo de simulación con el que se evaluó la telemetría que se muestra en esta pestaña.",
    "cobertura del producto": "Comprueba si el instante de simulación está dentro de la cobertura tabulada de este miembro SP3. Orbit no extrapola fuera de ella.",
    "marco nativo": "Marco de referencia declarado por el propio archivo SP3. Se conserva tal cual para no afirmar una transformación de realización que no se haya aplicado.",
    "marco de referencia": "Marco asociado al estado cartesiano mostrado en esta fila. Revísalo antes de comparar vectores procedentes de productos distintos.",
    "marco del estado": "Marco del vector de estado instantáneo publicado por el runtime.",
    "marco de representacion": "Etiqueta del marco con el que se representa el producto en Orbit; indica explícitamente si se han aplicado parámetros ERP.",
    "estado cartesiano": "Disponibilidad del vector posición/velocidad en el instante consultado. Puede no estar disponible fuera de cobertura o sin el contrato de marco requerido.",
    latitud: "Latitud geodésica derivada de un estado terrestre válido. No se muestra para un vector inercial o para un producto sin representación terrestre fiable.",
    longitud: "Longitud geodésica derivada de un estado terrestre válido. No se muestra para un vector inercial o para un producto sin representación terrestre fiable.",
    altitud: "Altura del satélite sobre el elipsoide de referencia, derivada del estado terrestre mostrado.",
    "distancia geocentrica": "Módulo del vector posición desde el centro de la Tierra; no es altitud sobre el elipsoide.",
    "modulo de velocidad": "Norma euclídea del vector velocidad instantáneo en el mismo marco y unidad que se indican en la fila.",
    "vector velocidad": "Componentes cartesianas de la velocidad instantánea. Deben compararse únicamente con vectores expresados en el mismo marco.",
    aceleracion: "Módulo de la aceleración instantánea disponible en la telemetría. No se inventa si el producto no publica o no permite derivarla.",
    "vector aceleracion": "Componentes cartesianas de aceleración disponibles en la telemetría del instante mostrado.",
    "estado de reproduccion": "Estado del runtime que reproduce la efeméride tabulada: activo, sin estado o no disponible según cobertura y marco.",
    interpolacion: "Método usado entre muestras tabuladas. SP3 se consulta dentro de su cobertura; no se extrapola después del último estado publicado.",
    "modo temporal": "Modo global del reloj de Orbit (tiempo real, simulación o vista estática) usado al consultar este dato.",
    "escala temporal": "Factor de avance del reloj de simulación. Es distinto de la escala de tiempo declarada por el archivo SP3.",
    "edad de telemetria": "Edad de la muestra publicada por el runtime respecto al instante actual de interfaz.",

    "archivo sp3": "Fichero SP3 que aporta las posiciones precisas y, cuando el registro es de tipo V, también velocidades tabuladas.",
    "version sp3": "Revisión del formato SP3 indicada en la cabecera. Afecta a cómo se interpretan sus registros, no a la clase de producto.",
    "tipo de registros": "P contiene posiciones; V contiene posiciones y registros de velocidad. Las velocidades solo se muestran si la fuente las publica de forma válida.",
    "epoca de cabecera": "Época declarada en la cabecera SP3 con su escala de tiempo original. GPS o TAI no se relabelan como UTC sin conversión explícita.",
    "epocas declaradas (cabecera)": "Número de épocas anunciado por la cabecera del fichero. Puede diferir de las muestras válidas de un miembro concreto.",
    "conjunto de datos": "Campo DATA USED de la cabecera SP3; describe el tipo de producto declarado por el proveedor.",
    "agencia de cabecera": "Código de agencia/originador indicado en la cabecera del SP3.",
    "tipo de orbita de cabecera": "Campo de tipo de órbita publicado en la cabecera SP3. Es metadato del producto, no una clasificación LEO/MEO/GEO derivada.",
    "inicio de cobertura utc": "Primera muestra válida de este satélite convertida a UTC con la escala de tiempo declarada por el producto.",
    "fin de cobertura utc": "Última muestra válida de este satélite convertida a UTC con la escala de tiempo declarada por el producto.",
    "muestras del satelite": "Número de estados tabulados válidos para este miembro GNSS. Es específico del satélite seleccionado, no del producto completo.",
    "cadencia media": "Separación media entre las muestras válidas de este satélite. Si el archivo no la declara, Orbit la deriva solo a partir de su cobertura y número de muestras.",
    "ventana de interpolacion": "Número de épocas vecinas que el interpolador tabular puede usar para obtener un estado entre dos muestras publicadas.",
    "escala temporal del producto": "Escala de tiempo declarada por el proveedor para el producto SP3, por ejemplo GPS, UTC o TAI.",
    "archivo clk": "Fichero RINEX CLK opcional con correcciones precisas de reloj. Complementa las correcciones que el propio SP3 pueda incluir.",
    "correcciones de reloj": "Disponibilidad y número de muestras de reloj para este miembro. Son sesgos/relojes GNSS, no componentes de posición ni velocidad.",
    "muestras de reloj sp3": "Número de correcciones de reloj embebidas en los registros SP3 para este satélite.",
    "muestras de reloj clk": "Número de correcciones de reloj del fichero RINEX CLK asociadas a este satélite.",
    "archivo erp": "Fichero de parámetros de rotación terrestre. Cuando se aplica y cubre el instante consultado, permite etiquetar explícitamente la representación con ERP.",
    "muestras erp": "Número de registros de parámetros de orientación terrestre disponibles en el ERP importado.",
    "archivo sum": "Resumen/metadatos publicados por el proveedor. Se conserva como procedencia del paquete, sin modificar las efemérides SP3.",
    "archivo att / obx": "Fichero de actitud del satélite, si el proveedor lo suministra. Su presencia no implica que Orbit lo aplique aún al modelo de actitud.",
    "archivo osb / bia": "Fichero de sesgos por observable. Es metadato de procesamiento GNSS y no se usa para alterar la órbita SP3.",
    "erp asociado": "ERP adjunto al producto. La presencia del fichero y su cobertura se mantienen explícitas para no afirmar una conversión ECI sin datos de orientación terrestre.",
    "estado": "Estado administrativo de este producto o capa dentro del runtime actual.",
    motor: "Motor o estrategia usada para obtener el estado. Un SP3 se reproduce desde estados publicados, no se propaga con un modelo de fuerzas de Orbit.",
    integrador: "Método numérico que integraría una órbita. Para SP3 no aplica: Orbit consulta/interpola estados tabulados dentro de la cobertura.",
    "modelo de fuerzas": "Modelo físico usado para propagar una órbita. Para SP3 está implícito en el producto publicado y no se reconstruye en Orbit.",
    "velocidades publicadas": "Indica si el SP3 declara registros de velocidad V. Si no existen, Orbit evita presentarlas como datos originales del proveedor."
});

function dynamicFieldHelp(key) {
    if (key.startsWith("posicion ")) {
        return "Vector cartesiano de posición instantánea expresado en el marco indicado en la propia etiqueta. No se transforma ni se compara con otro marco de forma implícita.";
    }
    if (key.startsWith("velocidad ")) {
        return "Vector cartesiano de velocidad instantánea expresado en el marco indicado en la propia etiqueta. Su interpretación depende de ese marco.";
    }
    if (key.startsWith("r / posicion ")) {
        return "Vector de posición del estado de entrada, en el marco declarado por el vector manual.";
    }
    if (key.startsWith("v / velocidad ")) {
        return "Vector de velocidad del estado de entrada, en el marco declarado por el vector manual.";
    }
    return null;
}

/**
 * Return an explanation for a detail-row label.
 *
 * An empty string intentionally means that the row has no trustworthy
 * description yet. The UI then remains non-focusable instead of exposing a
 * generic, unhelpful tooltip.
 */
export function getObjectDetailFieldHelp(label, { sourceFormat = "", section = "" } = {}) {
    const key = normalizedLabel(label);
    if (key === "escala temporal" && String(sourceFormat).toUpperCase() === "SP3" && section === "input") {
        return FIELD_HELP["escala temporal del producto"];
    }
    return FIELD_HELP[key] || dynamicFieldHelp(key) || "";
}

export { normalizedLabel as normalizeObjectDetailFieldLabel };
