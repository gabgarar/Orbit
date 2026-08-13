# Cowell: entrada y fuerzas

[Propagación](../index.md) · [Cowell](../cowell.md) · [Integradores numéricos](../numerical-integrators.md)

## Estado inicial

El constructor recibe una época `UTC` y un estado cartesiano manual en km y
km/s. Las claves canónicas son:

```text
position_eme2000_km: {x, y, z}
velocity_eme2000_km_s: {x, y, z}
```

`position_eci_km` y `velocity_eci_km_s` se conservan como alias heredados,
interpretados con la misma compatibilidad `EME2000`. El radio inicial debe estar
fuera de la Tierra y todos los componentes deben ser finitos.

## Composición de fuerzas

`central` siempre se incluye. La lista `force_terms` es explícita y debe
contener solo identificadores admitidos. Los identificadores disponibles son:

| Término | Identificador | Parámetros y contrato |
| --- | --- | --- |
| Central | `central` | Ninguno; obligatorio. |
| Zonales heredados | `j2`, `j3`, `j4` | Coeficientes WGS-84 internos; compatibilidad. |
| Geopotencial | `geopotential` | Campo ICGEM configurado, `degree`, `order`, EOP/leaps/ERFA estrictos. |
| Sol | `third-body-sun` | Efeméride solar local calculable y época válida. |
| Luna | `third-body-moon` | Efeméride lunar local calculable y época válida. |
| Arrastre | `drag` | `drag_coefficient`, `area_m2`, `mass_kg`. |
| SRP | `solar-radiation-pressure` | `solar_radiation_coefficient`, `area_m2`, `mass_kg`; eclipse declarado. |
| Relatividad | `relativity` | Ningún parámetro de usuario; corrección Schwarzschild terrestre. |

`sun`, `moon` y `srp` son alias de entrada para los identificadores canónicos.
No deben persistirse ni publicarse como identidad de modelo.

!!! warning "Exclusiones de seguridad"

    `geopotential` no puede coexistir con `j2`, `j3` o `j4`. Los parámetros
    físicos deben ser finitos y estrictamente positivos cuando corresponda:
    área, masa, \(C_D\) y \(C_R\). La operación debe fallar antes de integrar,
    no corregir silenciosamente valores inválidos.

## Parámetros físicos compartidos

| Parámetro | Unidad | Uso |
| --- | --- | --- |
| `area_m2` | m² | Área de referencia para drag y/o SRP. |
| `mass_kg` | kg | Masa para drag y/o SRP. |
| `drag_coefficient` | — | \(C_D\), solo para `drag`. |
| `solar_radiation_coefficient` | — | \(C_R\), solo para SRP. |
| `degree`, `order` | — | Límites del geopotencial ICGEM; con `geopotential`, `degree` debe ser al menos 2. |

La presencia de un parámetro no activa una fuerza. Por ejemplo, suministrar
`area_m2` no activa ni arrastre ni SRP si sus identificadores no están en
`force_terms`.

## Presets heredados

Los presets `two-body`, `j2` y `j2-j3-j4` se expanden a sus composiciones
históricas. Una lista `force_terms` explícita prevalece sobre presets y campos
heredados. No se actualiza un preset existente a geopotencial completo porque
eso cambiaría su resultado físico y su procedencia.

## Validación previa a la integración

Antes de crear el propagador se deben comprobar el estado, los parámetros,
incompatibilidades, disponibilidad de datos auxiliares y cobertura temporal. En
particular, `geopotential` debe rechazarse si no existe la ruta ITRF estricta;
Sol/Luna/SRP deben rechazarse fuera de la cobertura publicada por su efeméride.
Las validaciones de cada modelo se describen en [Modelos de fuerza](../force-models.md).
