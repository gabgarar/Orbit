# Efemérides e interpolación

## Visión general

El servicio Python valida el dominio orbital, adapta formatos, propaga, transforma marcos y ofrece primitivas de análisis. Se alcanza a través del gateway, nunca como servidor público independiente.

## Formatos

| Formato | Contrato |
| --- | --- |
| TLE | Entrada SGP4; marco nativo TEME. |
| OMM / OPM | Intercambio de elementos y parámetros orbitales. |
| OEM | Efemérides cartesianas con marco, escala y covarianza por segmento. |
| SP3 | Preparado para ingestión precisa; la realización terrestre será explícita. |
| CPF / RINEX | Cobertura declarada como soportada, parcial o no soportada. |

Un segmento OEM mantiene su escala y marco. La covarianza debe poder convertirse al marco del estado; si no, la importación falla antes de relabelar datos de forma insegura.

## Catálogo, análisis y exportación

El servicio inspecciona registros, crea órbitas manuales, analiza y genera salidas conscientes del formato. Comparación de propagadores, gráficas, estadísticas, eventos, medidas, tracking y alcance de OD conservan identidad de estado, época y transformaciones aplicadas.

## Evaluación, interpolación y visualización

En Orbit, «interpolación» puede significar tres cosas distintas. Conviene no
confundirlas:

1. **Evaluación física o de la fuente**: cómo el backend obtiene el estado en
   una época solicitada.
2. **Muestreo de una efeméride**: las épocas discretas que se piden al backend
   para una exportación, una órbita dibujada o una simulación de rango.
3. **Reproducción visual**: cómo el navegador mueve el marcador entre dos
   vértices ya calculados. No cambia el modelo físico ni convierte una
   polilínea en una nueva fuente de precisión.

La siguiente matriz resume el contrato que está implementado hoy.

| Fuente o motor | Evaluación del estado en backend | Fuera de cobertura / entre muestras | Reproducción en la UI actual |
| --- | --- | --- | --- |
| [TLE](formats/tle.md) y [OMM con TLE](formats/omm.md) | `SGP4Propagator` llama directamente a `Satrec.sgp4` en cada época UTC solicitada. No interpola una tabla ni integra RK4. | La validez es la propia de SGP4/TLE; no existe una efeméride tabulada que extrapolar. | La línea es una polilínea que une muestras SGP4 independientes. El suavizado breve del marcador entre mensajes en tiempo real es lineal y sólo visual. |
| [SP3](formats/sp3.md) | `Sp3StateProvider` impone Lagrange local acotado: grado `min(9, n-1)`, hasta diez muestras. No usa una declaración de interpolación del fichero. | Una muestra devuelve sólo esa época exacta. Con dos o más, la ventana se ajusta en los extremos y no se extrapola fuera de la cobertura. | El rango ya muestreado que recibe el navegador se recorre linealmente entre vértices; no vuelve a ejecutar Lagrange en JavaScript. |
| [OEM](formats/oem.md), lector Python `OemStateProvider` | Respeta `INTERPOLATION` del segmento: sin declaración usa lineal; `LINEAR` exige grado 1; `LAGRANGE` usa `grado + 1` registros; `HERMITE` usa posición y velocidad, grado impar y `(grado + 1)/2` registros. | No interpola entre segmentos ni extrapola. La covarianza se adjunta sólo en su época exacta. | La importación OEM del visor es una ruta local distinta: conserva puntos y los reproduce linealmente. Actualmente no interpreta `INTERPOLATION` ni `INTERPOLATION_DEGREE` del OEM. |
| Órbita manual de [dos cuerpos](propagation/two-body.md) | Solución analítica directa: avanza la anomalía media y resuelve Kepler en la época solicitada. No hay malla ni interpolación de estados. | No aplica cobertura tabulada. | La respuesta manual se dibuja con puntos calculados por el backend; entre esos puntos el marcador usa interpolación lineal de visualización. |
| Órbita manual [Cowell/RK4](propagation/cowell.md) | Integra hasta la época solicitada desde el estado cacheado más cercano, con RK4 de paso máximo fijo de 60 s y un último paso reducido si hace falta. | No interpola entre estados de caché; integra el intervalo restante, también hacia el pasado. | Igual que dos cuerpos: la trayectoria recibida es una polilínea y el marcador recorre sus vértices linealmente. |
| Preset manual J2+J3+J4 | De compatibilidad; delega en el mismo núcleo RK4 de paso fijo de Cowell, sin arrastre. | No interpola la caché. | Igual que Cowell. |
| [OPM](formats/opm.md) | No hay parser, proveedor de estado ni propagador implementado. | No aplica. | No aplica. |

!!! warning "Interpolación visual no es propagación"

    El navegador une los puntos de una trayectoria con segmentos rectos y, en
    una línea temporal, interpola linealmente la posición entre dos muestras
    con hora válida. Es una reproducción fluida de datos ya calculados. Para
    SP3 u OEM no sustituye la interpolación de backend; para TLE, dos cuerpos
    o Cowell no sustituye una evaluación directa del modelo. Fuera del rango
    de una pista temporal válida el objeto se marca como fuera de tiempo, no
    se prolonga visualmente la trayectoria.

### Productos GNSS auxiliares

Los auxiliares de un producto preciso no son una segunda interpolación de
órbita:

| Fichero | Método usado hoy |
| --- | --- |
| SP3 | Es la única fuente de posiciones y, opcionalmente, velocidades `V`. Una velocidad sólo se interpola si todos los nodos Lagrange seleccionados la contienen; Orbit no la deriva de las posiciones SP3 ni fabrica aceleración. |
| ERP | `IgsErpEarthOrientationProvider` interpola linealmente dentro de cobertura `UT1-UTC`, `xp`, `yp` y, si está en ambos extremos, LOD. ERP v2 no publica `dX`/`dY`; Orbit los fija a cero, no los infiere de ese fichero. No extrapola por defecto. Se usa para la orientación terrestre en la ruta inercial habilitada. |
| CLK | Se parsean y conservan muestras de reloj por satélite; no existe un método `at()` ni una interpolación de reloj que modifique la órbita. |
| SUM, ATT/OBX y OSB/BIA | Se conservan como procedencia y archivos auxiliares. Hoy no alimentan una evaluación temporal, una interpolación ni la geometría de la órbita. |

Consulte [Productos GNSS precisos](formats/precise-products.md) para los
campos de cada fichero y [SP3](formats/sp3.md) para la ventana Lagrange por
satélite.

## Ecuaciones de efemérides

Las siguientes ecuaciones describen los proveedores tabulados. En particular,
OEM puede declarar el método de su segmento; SP3 usa la política Lagrange
local de Orbit descrita arriba, no una declaración `INTERPOLATION` del SP3.
Para dos muestras consecutivas y \(\alpha=(t-t_0)/(t_1-t_0)\), la ruta lineal usa:

$$
\mathbf x(t)=(1-\alpha)\mathbf x_0+\alpha\mathbf x_1.
$$

Para una ventana Lagrange, cada componente vectorial se evalúa con:

$$
\mathbf x(t)=\sum_{i=0}^{n}\mathbf x_i
\prod_{\substack{j=0\\j\ne i}}^{n}
\frac{t-t_j}{t_i-t_j}.
$$

La ruta Hermite construye un polinomio que satisface las restricciones de posición y velocidad declaradas:

$$
H(t_i)=\mathbf r_i,\qquad \dot H(t_i)=\mathbf v_i.
$$

La aceleración Hermite se deriva del polinomio, \(\mathbf a(t)=\ddot H(t)\). Orbit no interpola la covarianza: la salida interpolada declara explícitamente que la covarianza es nula.

### Variables, unidades y uso en Orbit

Las muestras \(\mathbf r_i\), \(\mathbf v_i\) y la salida \(\mathbf r(t)\) se normalizan a m y m/s en `StateVector`; \(t\), \(t_i\) y \(\Delta t\) son segundos respecto a la época de consulta. Los pesos de Lagrange y Hermite son adimensionales, y la aceleración derivada es m/s². `TabularStateProvider` aplica estas ecuaciones solo entre muestras del segmento seleccionado; no interpola covarianza ni inventa marco, escala o unidades ausentes.

## Límites

- SP3 y OEM de alta fidelidad no se degradan a semántica TLE.
- No se anuncia precisión, datum o modelo de fuerzas que el origen no haya establecido.
- Los formatos no soportados siguen siendo límites explícitos.
