# Visión general de formatos

[Inicio](../index.md) · [Formatos](index.md) · [Estados cartesianos](../engineering/cartesian-states.md) · [Propagación](../propagation/overview.md)

## Matriz de disponibilidad

| Formato | Importación de catálogo/UI | Lector Python de estados | Propagación en runtime | Exportación |
| --- | --- | --- | --- | --- |
| [TLE](tle.md) | Sí. | Carga de catálogo TLE. | Sí, SGP4. | TLE; efemérides CSV/JSON/OEM muestreadas con SGP4. |
| [OMM](omm.md) | Sí, JSON/XML cuando contiene TLE. | No hay lector OMM de estado general. | Sí, como TLE extraído. | OMM JSON/XML mínimo. |
| [OEM](oem.md) | El visor puede cargar un track local temporal; no crea un objeto de catálogo. El gateway solo extrae TLE embebido. | Sí, segmentado e interpolado. | No integrado en `OrbitRuntime`. | Cabecera OEM de catálogo y OEM de efemérides SGP4. |
| [SP3](sp3.md) y [productos GNSS precisos](precise-products.md) | Sí, como importación local de SP3, con CLK opcional. | Sí, por satélite e interpolado. | Sí, como efeméride tabulada de runtime. | No. |
| [OPM](opm.md), [CPF](cpf.md) y RINEX de observaciones | No. | No. | No. | No. |

## Fronteras de producto

```mermaid
flowchart LR
    U[UI / Gateway] --> C[Catálogo TLE u OMM con TLE]
    C --> R[OrbitRuntime / SGP4]
    U --> P[Importación local SP3 + CLK opcional]
    P --> T[Proveedor tabulado por satélite]
    T --> R
    V[Visor web] --> L[Track OEM local y transitorio]
    O[OEM Python] --> T[TabularStateProvider]
    S[SP3 Python] --> T
    T --> F[FrameTransformService]
    O -. no conectado al runtime .-> U
```

El visor web dispone de una ruta local y transitoria para visualizar un OEM
puro. Esa ruta no registra un objeto de catálogo, no pasa por Gateway/FastAPI
ni entrega una fuente de efemérides a `OrbitRuntime`. En cambio, la importación
de producto GNSS preciso registra una fuente SP3 tabulada por satélite, con
reloj CLK opcional y metadatos de procedencia. El registro se conserva en el
almacén local de productos precisos y el runtime lo rehidrata al iniciar. No
convierte el producto en un objeto TLE ni descarga archivos desde el proveedor.
Consulte [Productos GNSS precisos](precise-products.md).

## Contrato tabulado común

OEM y SP3 se convierten en `TabularStateProvider`. Sus muestras deben compartir
marco, realización, centro y escala temporal dentro de una serie/segmento; las
épocas son estrictamente crecientes y no pueden duplicarse.

| Interpolación | Disponibilidad |
| --- | --- |
| Lineal | Predeterminada cuando no existe declaración OEM. |
| Lagrange | OEM declarado, con grado y suficientes muestras. |
| Hermite | OEM declarado, grado impar y velocidad en todas las muestras elegidas. |

Las consultas fuera de la cobertura se rechazan. La covarianza OEM no se
interpola; solo se adjunta a su época de solución exacta.

## Marcos y escalas

Los lectores preservan el origen. Una transformación a ITRF requiere una ruta
del servicio de marcos; una realización IGS no se convierte a ITRF sin una
operación registrada. Las conversiones GPS/TAI/TT/UT1 usan la misma tabla de
segundos intercalares y EOP que el transformador asociado.

Consulte [Sistemas temporales](../engineering/time-systems.md) y
[Marcos de referencia](../engineering/reference-frames.md).

## OCM simplificado

El gateway puede exportar un JSON identificado como OCM que contiene nombre,
identificador, formato de origen y las dos líneas TLE. No existe lector OCM ni
una implementación de todos los perfiles OCM; esa salida no debe anunciarse
como soporte completo del estándar.
