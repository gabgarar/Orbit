# Intercambio externo de estaciones

[Inicio](../../index.md) · [Formatos de estaciones de tierra](index.md)

## Estado de soporte

Orbit no implementa importación ni exportación de estaciones mediante CSV,
GeoJSON, KML, SINEX, IGS site log u otro estándar externo. Tampoco interpreta
un fichero externo como una capa de estación.

!!! warning "Formato previsto para implementación futura"

    Un importador deberá declarar el CRS, el datum horizontal y vertical, las
    unidades, la época de coordenadas y el mapeo de los atributos operativos.
    No se asignarán implícitamente a WGS-84 por el nombre de las columnas.

## Alternativa actual

Cree la estación en el espacio de trabajo y guarde el proyecto JSON.
