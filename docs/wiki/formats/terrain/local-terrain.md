# Archivos locales de terreno

[Inicio](../../index.md) · [Formatos de terreno](index.md)

## Estado de soporte

Orbit no importa archivos de terreno locales. No hay lector, catálogo ni
persistencia de GeoTIFF, DEM, DTED, cuantized-mesh, 3D Tiles o modelos de
elevación equivalentes.

!!! warning "Formato previsto para implementación futura"

    El soporte local requerirá declarar el formato, sistema de referencia,
    datum vertical, resolución, cobertura y política de caché. No debe
    asumirse a partir de una imagen o de un proveedor Cesium externo.

## Alternativa actual

Use Cesium World Terrain cuando esté disponible o el elipsoide visual de
fallback. Ninguna de las dos rutas crea un activo de terreno de proyecto.
