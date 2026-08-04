# Formatos orbitales

[Inicio](../../index.md) · [Formatos](../index.md)

## Visión general

Estos formatos describen un objeto orbital, sus elementos o sus efemérides.
Orbit separa la carga operativa del catálogo, los lectores internos Python y
las trayectorias locales del visor.

| Grupo | Formatos | Contrato actual |
| --- | --- | --- |
| Elementos | [TLE](../tle.md), [OMM](../omm.md), [OPM](../opm.md) | TLE y OMM con TLE embebido alimentan el catálogo; OPM no está disponible. |
| Efemérides | [OEM](../oem.md), [SP3](../sp3.md), [CPF](../cpf.md) | OEM puede visualizarse localmente y OEM/SP3 tienen lector Python; CPF no está disponible. |

## Rutas de consumo

- El catálogo usa TLE y OMM que contienen ambas líneas TLE.
- El visor puede cargar un OEM tabulado como trayectoria temporal local.
- Los lectores Python OEM y SP3 no quedan registrados en `OrbitRuntime` ni se
  exponen como carga pública de UI/API.

Consulte [efemérides e interpolación](../../orbit-service.md) para los
contratos de los proveedores tabulados.
