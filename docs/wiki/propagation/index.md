# Propagación

[Inicio](../index.md) · [Ingeniería](../engineering/index.md) · [Formatos](../formats/index.md)

Orbit distingue entre el modelo que genera el estado nativo y la transformación
posterior para una vista terrestre. El catálogo registra SGP4; las órbitas
manuales disponen de rutas analíticas y numéricas con contratos explícitos de
marco, tiempo, datos y límites.

## Mapa de propagadores y modelos

| Tema | Estado |
| --- | --- |
| [Visión general](overview.md) | Contrato común y selección de motores. |
| [SGP4](sgp4.md) | TLE de catálogo; no es un motor de órbita manual. |
| [Dos cuerpos](two-body.md) | Modelo kepleriano analítico manual. |
| [Cowell](cowell.md) | Integración RK4 de fuerzas seleccionadas. |
| [Integradores numéricos](numerical-integrators.md) | RK4 fijo; adaptativo, eventos y covarianza pendientes. |
| [Modelos de fuerza](force-models.md) | Composición, marcos y procedencia. |
| [Masa puntual](point-mass.md) | Gravedad central. |
| [J2](j2.md), [J3](j3.md), [J4](j4.md) | Términos zonales de compatibilidad. |
| [Geopotencial configurable](full-geopotential.md) | Disponible con ICGEM local, grado/orden e ITRF estricto. |
| [Terceros cuerpos](third-bodies.md) | Disponible para Sol (`eraEpv00`) y Luna (`eraMoon98`) aproximados. |
| [Arrastre atmosférico](atmospheric-drag.md) | Término Cowell exploratorio de primer orden. |
| [Presión de radiación solar](solar-radiation-pressure.md) | Disponible: cannonball y umbra cilíndrica. |
| [Relatividad](relativity.md) | Disponible: Schwarzschild terrestre. |
| [Mareas](tides.md), [albedo](albedo.md), [actitud](attitude.md) | Pendientes y documentados sin prometer disponibilidad. |

!!! warning "Ámbito científico"

    Los motores manuales no son una cadena de alta fidelidad ni un sistema de
    determinación de órbita. Seleccionar un propagador o ver una sección de
    documentación no activa una fuerza: el runtime debe declarar la capacidad,
    validar los datos auxiliares y registrar la procedencia efectiva.
