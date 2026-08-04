# Formatos de terreno

[Inicio](../../index.md) · [Formatos](../index.md)

## Visión general

Orbit consume terreno para la visualización Cesium; no lo interpreta como un
producto científico de órbita ni lo almacena en el backend Python.

| Fuente | Estado | Uso |
| --- | --- | --- |
| [Cesium World Terrain](world-terrain.md) | Disponible al iniciar, si el proveedor remoto responde. | Relieve del globo. |
| [Archivos locales](local-terrain.md) | No disponible. | No hay importación ni catálogo de terreno. |

El fallo del proveedor remoto no bloquea la aplicación: Orbit usa el elipsoide
local de Cesium como fallback visual.
