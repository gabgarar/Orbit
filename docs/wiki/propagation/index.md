# Propagación

[Inicio](../index.md) · [Ingeniería](../engineering/index.md) · [Formatos](../formats/index.md)

Orbit distingue entre el modelo que genera el estado nativo y la transformación
posterior para una vista terrestre. La disponibilidad del motor depende del
origen: el catálogo registra SGP4; las órbitas manuales disponen de rutas
analíticas y numéricas delimitadas.

## Mapa de propagadores y modelos

| Tema | Estado |
| --- | --- |
| [Visión general](overview.md) | Contrato común y selección de motores. |
| [SGP4](sgp4.md) | TLE de catálogo y TLE sintético manual. |
| [Dos cuerpos](two-body.md) | Modelo kepleriano analítico manual. |
| [Cowell](cowell.md) | Integración RK4 de fuerzas seleccionadas. |
| [Integradores numéricos](numerical-integrators.md) | RK4 fijo y límites de uso. |
| [Modelos de fuerza](force-models.md) | Composición disponible. |
| [Masa puntual](point-mass.md) | Gravedad central. |
| [J2](j2.md) | Ruta analítica y término numérico. |
| [J3](j3.md) | Término zonal numérico de Cowell. |
| [J4](j4.md) | Término zonal numérico de Cowell. |
| [Geopotencial completo](full-geopotential.md) | Estado de soporte: no disponible. |
| [Terceros cuerpos](third-bodies.md) | Estado de soporte: no disponible. |
| [Arrastre atmosférico](atmospheric-drag.md) | Término Cowell de primer orden. |
| [Presión de radiación solar](solar-radiation-pressure.md) | Estado de soporte: no disponible. |
| [Relatividad](relativity.md) | Estado de soporte: no disponible. |

!!! warning "Ámbito científico"

    Los motores manuales no son una cadena de alta fidelidad ni un sistema de
    determinación de órbita. La selección de un propagador no activa fuerzas
    que no se indiquen expresamente en su contrato.
