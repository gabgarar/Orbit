# Eventos orbitales

[Análisis](index.md){ .md-button } [Estaciones de tierra](../user-guide/ground-stations.md){ .md-button }

Orbit no incluye un motor genérico de detección de eventos orbitales. La
capacidad disponible relacionada con eventos es el cálculo de AOS/LOS para
una estación de tierra, obtenido mediante muestreo de la geometría de
visibilidad sobre una ventana temporal.

## AOS y LOS

| Término | Definición operacional |
| --- | --- |
| AOS | Primera muestra de una ventana en la que el objeto cumple la máscara de elevación configurada. |
| LOS | Primera muestra posterior en la que deja de cumplirse esa máscara. |
| Paso de muestreo | Resolución temporal que limita la precisión temporal del resultado. |

!!! warning "Precisión de evento"

    El cálculo actual no refina el cruce mediante búsqueda de raíces. Un AOS o
    LOS debe interpretarse con una incertidumbre vinculada al paso configurado
    y al modelo de trayectoria utilizado.

## Estado

**No disponibles:** detección de eclipses, cruces de nodos, perigeo/apogeo,
maniobras, conjunciones, reentrada, eventos de iluminación o reglas de evento
definidas por el usuario.

## Referencias relacionadas

- [Tracking](tracking.md)
- [Modelos de la Tierra](../engineering/earth-models.md)
- [Cowell](../propagation/cowell.md)
