# Bibliografía

## Uso de las referencias

Las fuentes externas sitúan los estándares, convenciones y algoritmos que
aparecen en Orbit. Citar una fuente no implica que Orbit implemente toda su
cobertura, sus perfiles opcionales o sus niveles de precisión. La disponibilidad
concreta se define por los contratos y límites de la aplicación.

## Marcos, orientación terrestre y tiempo

| Referencia | Aplicación en Orbit |
| --- | --- |
| Petit, G.; Luzum, B. (eds.). [IERS Conventions (2010), IERS Technical Note 36](https://www.iers.org/SharedDocs/Publikationen/EN/IERS/Publications/tn/TechnNote36/tn36.pdf?__blob=publicationFile&v=1). | Terminología y convenciones para marcos celestes/terrestres, orientación y escalas temporales. |
| IERS. [Conventions Centre](https://www.iers.org/iers/en/dataproducts/conventions/conventions). | Estado editorial de las convenciones y actualizaciones asociadas. |
| IERS. [EOP 20u24 C04, producto y metadatos](https://datacenter.iers.org/products/eop/long-term/c04_20u24/). | Fuente recomendada para snapshots C04 locales con DUT1, movimiento polar y `dX`/`dY`; debe fijarse la revisión exacta y su hash. |
| IERS/USNO. [Bulletin A](https://maia.usno.navy.mil/products/bulletin-a). | Ruta futura para EOP rápidos y predicciones; Orbit no lo importa directamente. |
| IERS. [ITRS e ITRF](https://www.iers.org/iers/en/dataproducts/itrs/itrs). | Distinción entre sistema terrestre conceptual y sus realizaciones. |
| IAU SOFA. [Standards of Fundamental Astronomy](https://www.iausofa.org/). | Base de las rutinas astronómicas de referencia. |
| ERFA. [Essential Routines for Fundamental Astronomy](https://github.com/liberfa/erfa). | Implementación libre de rutinas SOFA utilizada a través de `pyerfa`. |
| IETF. [RFC 5905 — Network Time Protocol](https://www.rfc-editor.org/rfc/rfc5905). | Contexto del formato `leap-seconds.list` NTP/IERS que puede leer Orbit. |

## Propagación orbital

| Referencia | Aplicación en Orbit |
| --- | --- |
| Vallado, D. A.; Crawford, P.; Hujsak, R.; Kelso, T. S. [Revisiting Spacetrack Report #3](https://celestrak.org/publications/AIAA/2006-6753/), AIAA 2006-6753. | Referencia de la teoría y los casos de prueba SGP4 usados para TLE. |
| CelesTrak. [Documentación de software y teoría SGP4](https://celestrak.org/software/tskelso-sw.php). | Material complementario de implementación y compatibilidad SGP4. |

Los propagadores de dos cuerpos y Cowell/RK4 de Orbit son implementaciones con
alcance limitado. No se debe deducir de las referencias anteriores que Orbit
incluya validación de misión, determinación de órbita, estimación de
incertidumbre o todos los modelos de fuerzas de una biblioteca astrodinámica
general.

## Formatos de intercambio

| Referencia | Aplicación en Orbit |
| --- | --- |
| CCSDS. [Publicaciones activas — Orbit Data Messages, CCSDS 502.0-B-3](https://ccsds.org/publications/allpubs/). | Contexto normativo de OMM, OEM y OCM. Orbit implementa únicamente los perfiles y rutas descritos en su documentación. |
| CCSDS. [Orbit Data Messages, 502.0-B-3](https://public.ccsds.org/Pubs/502x0b3e1.pdf). | Documento de referencia para la familia ODM. |
| International GNSS Service. [IGS20 y transición de productos](https://igs.org/news/igs20/). | Contexto de IGS20, igs20.atx y su relación con ITRF2020. |
| International GNSS Service. [Reference Frame Working Group](https://igs.org/wg/reference-frame/). | Información de realizaciones IGS, estaciones y productos de referencia. |
| International GNSS Service. [Parámetros ITRF2020→IGS20](https://files.igs.org/pub/station/coord/IGS20/ITRF2020_to_IGS20.txt). | Fuente de los parámetros publicados para el alineamiento global opcional de Orbit. |
| International GNSS Service. [Productos IGS](https://igs.org/products/). | Referencia de ERP asociados a series GNSS; Orbit conserva el ERP seleccionado explícitamente con SP3 y no lo descarga ni empareja de forma automática. |
| ISO. [ISO 8601 — formatos de fecha y hora](https://www.iso.org/iso-8601-date-and-time-format.html). | Convención de intercambio para instantes enviados a la API. |

## Fuentes de implementación del repositorio

| Recurso | Contenido |
| --- | --- |
| `server/python/orbit_api/frames/` | Contrato `StateVector`, transformaciones y realizaciones terrestres. |
| `server/python/orbit_api/timekeeping/` | Escalas, segundos intercalares, EOP y configuración local. |
| `server/python/orbit_api/formats/` | Lectores OEM y SP3 con metadatos de origen. |
| `server/python/orbit_api/orbits/propagators/` | Propagadores SGP4, dos cuerpos, Cowell/RK4 y rutas heredadas. |
| `server/python/tests/` | Pruebas que fijan los contratos de los módulos Python. |
| `server/tests/node/` | Pruebas de gateway, catálogo, proxy y despliegue. |
| `docs/general/TIME_EOP_OPERATIONS.md` | Procedimiento operativo local de EOP y leap seconds. |

## Cita de resultados de Orbit

Un resultado que dependa de propagación o transformación terrestre debe
registrar, como mínimo:

1. Versión o commit de Orbit empleado.
2. Definición TLE, estado inicial u origen del producto tabular.
3. Propagador, opciones de fuerza, paso y rango de muestreo.
4. Marco, realización terrestre, escala temporal y unidades de entrada/salida.
5. Identidad del snapshot EOP y de la tabla de segundos intercalares cuando
   intervengan.
6. Configuración que altera el resultado o la selección de catálogo.

## Referencias relacionadas

- [Glosario](glossary.md)
- [Apéndice](appendix.md)
- [Arquitectura](../development/architecture.md)
