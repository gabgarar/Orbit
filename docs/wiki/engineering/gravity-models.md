# Modelos de gravedad

[Inicio](../index.md) · [Ingeniería](index.md) · [Modelos de Tierra](earth-models.md) · [Modelos de fuerza](../propagation/force-models.md)

## Capas de gravedad en Orbit

Los modelos de gravedad se usan únicamente en propagación manual. Un objeto TLE
usa SGP4 y no acepta esta composición como selector operativo.

| Modelo | Identificador | Estado | Uso |
| --- | --- | --- | --- |
| Punto masa | `central` | Disponible. | Dos cuerpos y término obligatorio de Cowell. |
| Zonales J2/J3/J4 | `j2`, `j3`, `j4` | Disponible por compatibilidad. | Estudios manuales heredados. |
| Armónicos esféricos ICGEM | `geopotential` | Disponible con campo local configurado. | Campo configurable hasta grado/orden con ruta ITRF estricta. |

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

El modelo nuevo se define mediante un fichero ICGEM `.gfc` y una selección de
grado \(N\) y orden \(M\). Solo se aceptan coeficientes completamente
normalizados. La relación zonal es:

$$
J_n=-\sqrt{2n+1}\;\bar C_{n0}.
$$

Esto explica por qué J2, J3 y J4 ya están incluidos si el campo contiene esos
grados. J1 no se expone: en un sistema geocéntrico de centro de masas representa
un desplazamiento de origen, no una perturbación física que deba activarse.

El término armónico aporta la parte no central de la aceleración. `central`
sigue siendo obligatorio, y `geopotential` se excluye mutuamente con los
interruptores J2/J3/J4 para evitar doble conteo.

El contrato de selección admite hasta **2159 × 2159**, que es el máximo
semántico de un campo completo EGM2008. No debe confundirse con el presupuesto
del evaluador actual: el RK4 Python rechaza de forma explícita una etapa con
más de 2.555 coeficientes armónicos no centrales. Un campo `70 × 70` denso cabe
como perfil actual; una selección zonal/de orden bajo puede alcanzar mayor grado si
respeta ese presupuesto. No existe truncación silenciosa. La tabla de elección
por LEO, MEO/GNSS, GEO y misión se mantiene en
[Geopotencial configurable](../propagation/full-geopotential.md).

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

Un resultado que usa un campo armónico debe registrar campo, fuente, huella,
normalización, \(\mu\), radio de referencia, grado, orden, EOP, leap seconds,
realización terrestre y método de transformación. Si algún requisito falta, el
modelo debe quedar deshabilitado y el resultado no se puede presentar como
ITRF/ECI riguroso.

## Límites actuales y siguientes incrementos

El campo estático no cubre mareas, variación temporal, carga atmosférica ni
correcciones estacionales. Tampoco sustituye un integrador adaptativo ni una
validación frente a una efeméride de referencia. Esos elementos se mantienen
explícitamente pendientes en [Mareas](../propagation/tides.md) y
[Integradores numéricos](../propagation/numerical-integrators.md).
