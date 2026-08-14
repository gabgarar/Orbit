# Modelos de gravedad

[Inicio](../index.md) · [Ingeniería](index.md) · [Modelos de Tierra](earth-models.md) · [Modelos de fuerza](../propagation/force-models.md)

## Capas de gravedad en Orbit

Los modelos de gravedad se usan únicamente en propagación manual. Un objeto TLE
usa SGP4 y no acepta esta composición como selector operativo.

| Modelo | Identificador | Estado | Uso |
| --- | --- | --- | --- |
| Punto masa | `central` | Disponible. | Dos cuerpos y término obligatorio de Cowell. |
| Zonales J2/J3/J4 | `j2`, `j3`, `j4` | Disponible por compatibilidad. | Estudios manuales heredados. |
| Armónicos esféricos | `geopotential` | Disponible con un campo ICGEM local explícito o una caché NGA automática validada. | Campo configurable en ITRF; órbita manual usa IERS automático o rotación nominal etiquetada. |

## Zonales heredados

Cowell conserva términos zonales independientes con los coeficientes WGS-84
internos:

| Coeficiente | Valor |
| --- | ---: |
| \(J_2\) | \(1.08262668355315\times10^{-3}\) |
| \(J_3\) | \(-2.53265648533224\times10^{-6}\) |
| \(J_4\) | \(-1.61962159136700\times10^{-6}\) |

Se evalúan como una implementación de compatibilidad en `EME2000`, tratando su
eje \(Z\) como eje terrestre fijo. Son útiles para conservar resultados y para
estudios de primer orden, pero no equivalen a rotar un campo ligado a la Tierra
en cada etapa de integración.

## Campo armónico configurable

El modelo se define mediante un fichero ICGEM `.gfc` explícito o una caché
automática NGA `EGM96`/`EGM2008` validada, más la selección de grado \(N\) y
orden \(M\). Solo se aceptan coeficientes completamente normalizados. La
relación zonal es:

$$
J_n=-\sqrt{2n+1}\;\bar C_{n0}.
$$

Esto explica por qué J2, J3 y J4 ya están incluidos si el campo contiene esos
grados. J1 no se expone: en un sistema geocéntrico de centro de masas representa
un desplazamiento de origen, no una perturbación física que deba activarse.

El término armónico aporta la parte no central de la aceleración. `central`
sigue siendo obligatorio, y `geopotential` se excluye mutuamente con los
interruptores J2/J3/J4 para evitar doble conteo.

El modelo seleccionado solo puede elegirse numéricamente tras validar su fuente
de coeficientes descomprimida. Entonces el registro publica `maxDegree`,
`maxOrder`, un resumen de cobertura por grado, `completeThroughDegree` y
`tailMaxOrder`; la UI limita grado/orden a esos hechos detectados y devuelve una
selección efectiva `clamped` explícita cuando procede. Antes de validar, los
límites numéricos son `null` y el selector falla cerrado.

El archivo EGM2008 se maneja dentro de un sobre protector/informativo de
2190 × 2190, pero no es un límite científico efectivo ni una afirmación de
matriz densa. Controla el archivo real ya descomprimido. Esto no debe
confundirse con el presupuesto del evaluador actual: el RK4 Python rechaza de
forma explícita una etapa con más de 2.555 coeficientes armónicos no centrales.
Un campo `70 × 70` denso cabe en el perfil actual; una selección zonal/de orden
bajo puede alcanzar grados superiores si continúa dentro de ese presupuesto.
No hay truncado silencioso. La tabla de selección para LEO, MEO/GNSS, GEO y
misión se mantiene en
[Geopotencial configurable](../propagation/full-geopotential.md).

## Caché automática NGA

El registro puede renovar archivos oficiales EGM96 o EGM2008 en
`data/geopotential` después de que la API esté saludable. Valida una caché
local antes de usarla, la renueva tras la antigüedad configurada (30 días por
defecto), acepta únicamente las URL HTTPS fijas de NGA sin redirecciones,
valida el miembro ZIP esperado y toda la cobertura de coeficientes, e instala
el resultado de forma atómica junto con su huella. No descarga nada dentro de
una etapa de propagación.

Built-In Test publica los límites detectados y el perfil de cobertura después
de esa validación. `hardMaxDegree`/`hardMaxOrder` del parser son solo techos de
protección de entrada; no se ofrecen como capacidad de modelo no verificada.

Un campo explícito `ORBIT_GRAVITY_FIELD_PATH` sigue siendo la elección
reproducible de prioridad superior. Si no puede completarse el refresco
automático, una caché válida anterior sigue disponible con **Warning**; si no
existe, `geopotential` queda no disponible, sin fallback a J2/J3/J4. La caché
NGA no aporta ERP ni una ruta ECI estricta.

## Marco correcto de evaluación

Los coeficientes \(\bar C_{nm},\bar S_{nm}\) describen la distribución de masa
respecto a la Tierra. La latitud y longitud con las que se evalúan deben ser de
un ITRF instantáneo. En cada etapa RK4 Orbit debe:

1. transformar el estado de `EME2000` a ITRF con EOP, UT1 y TT adecuados;
2. calcular el gradiente armónico analítico en ITRF;
3. rotar la aceleración libre de nuevo a `EME2000`.

No se debe integrar la dinámica en ITRF salvo que se implementen explícitamente
las fuerzas ficticias de marco rotante. Consulte [Geopotencial configurable](../propagation/full-geopotential.md).

## Requisitos de trazabilidad

Un resultado que use un campo armónico debe registrar campo, URL de fuente o
fuente local, huella de archivo/fichero, instante de validación de caché,
normalización, sistema de marea, \(\mu\), radio de referencia, grado/orden
detectados y perfil de cobertura, grado/orden solicitados y efectivos, EOP,
segundos intercalares, realización terrestre y método de transformación. Si
falta la ruta temporal (por ejemplo segundos intercalares o ERFA/SOFA), el
modelo debe seguir deshabilitado. Si solo falta EOP automático, la órbita manual
se etiqueta como rotación nominal y nunca puede presentarse como ITRF/ECI
riguroso.

## Límites actuales y siguientes incrementos

El campo estático no cubre mareas, variación temporal, carga atmosférica ni
correcciones estacionales. Tampoco sustituye un integrador adaptativo ni una
validación frente a una efeméride de referencia. Esos elementos se mantienen
explícitamente pendientes en [Mareas](../propagation/tides.md) y
[Integradores numéricos](../propagation/numerical-integrators.md).
