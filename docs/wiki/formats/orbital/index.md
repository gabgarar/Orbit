# Formatos orbitales

[Inicio](../../index.md) · [Formatos](../index.md)

## Visión general

Estos formatos describen un objeto orbital, sus elementos o sus efemérides.
Orbit separa la carga operativa del catálogo, los lectores internos Python y
las trayectorias locales del visor.

| Grupo | Formatos | Contrato actual |
| --- | --- | --- |
| Elementos | [TLE](../tle.md), [OMM](../omm.md), [OPM](../opm.md) | TLE y OMM con TLE embebido alimentan el catálogo; OPM no está disponible. |
| Efemérides | [OEM](../oem.md), [SP3](../sp3.md), [CPF](../cpf.md) | OEM puede visualizarse localmente; SP3 + CLK opcional se importa como producto GNSS preciso durable; CPF no está disponible. |

## Rutas de consumo

- El catálogo usa TLE y OMM que contienen ambas líneas TLE.
- El visor puede cargar un OEM tabulado como trayectoria temporal local.
- OEM sigue siendo una trayectoria local transitoria y no queda registrado en
  `OrbitRuntime`.
- SP3 se registra por satélite como fuente tabulada de runtime mediante la
  importación local de [productos GNSS precisos](../precise-products.md). El
  CLK RINEX opcional conserva datos de reloj, no una segunda trayectoria.

Consulte [efemérides e interpolación](../../orbit-service.md) para los
contratos de los proveedores tabulados.
