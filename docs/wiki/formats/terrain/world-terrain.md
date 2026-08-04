# Cesium World Terrain

[Inicio](../../index.md) · [Formatos de terreno](index.md)

## Disponibilidad

El visor solicita `Cesium.createWorldTerrainAsync()` durante el arranque. Si
el proveedor se resuelve, Cesium entrega el relieve remoto; Orbit no descarga,
convierte ni versiona sus teselas.

## Fallback

Si la solicitud falla, el visor usa `EllipsoidTerrainProvider`. Este fallback
mantiene la aplicación operativa, pero no representa elevación topográfica.

## Límites

La fuente se usa solo para renderizado. No modifica estados propagados, la
visibilidad calculada ni los contratos de marcos y tiempo.
