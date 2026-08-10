# Formatos de estaciones de tierra

[Inicio](../../index.md) · [Formatos](../index.md) · [Estaciones de tierra](../../user-guide/ground-stations.md)

## Visión general

Una estación es una capa de proyecto con posición WGS-84 y configuración RF
autorada. Puede persistirse dentro de un proyecto completo o intercambiarse de
forma independiente sin convertirla en un objeto de catálogo.

| Ruta | Estado | Uso |
| --- | --- | --- |
| [JSON de proyecto](project-json.md) | Disponible. | Persistencia del espacio de trabajo completo. |
| [Intercambio de estaciones](interchange.md) | GeoJSON, Orbit JSON y CSV importan/exportan; KML/KMZ, GeoPackage, WKT/WKB exportan. | Puntos de estación WGS-84 independientes. |
| [RINEX](../rinex.md) | No disponible. | No crea estaciones ni observaciones GNSS. |
