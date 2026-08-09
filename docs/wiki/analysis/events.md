# Pases y visibilidad

[Segmento terrestre](../ground-segment/index.md){ .md-button } [Estaciones de tierra](../user-guide/ground-stations.md){ .md-button }

Orbit no incluye un motor genérico de detección de eventos orbitales. La
capacidad disponible relacionada con eventos es el cálculo de AOS/LOS para
una estación de tierra, obtenido mediante muestreo de la geometría de
visibilidad sobre una ventana temporal.

## AOS y LOS

| Término | Definición operacional |
| --- | --- |
| AOS | Instante refinado en que un objeto pasa a cumplir la máscara de elevación y el criterio de enlace configurados. |
| LOS | Instante refinado posterior en que deja de cumplirse alguno de esos criterios. |
| Paso de muestreo | Cadencia de exploración que localiza los intervalos candidatos de un pase. |

!!! warning "Precisión de evento"

    Orbit explora primero la ventana temporal con el paso configurado. Cuando
    dos muestras consecutivas encierran un cambio de visibilidad, refina ese
    intervalo por bisección hasta aproximadamente 0,5 s. Por tanto, un AOS o
    LOS no queda limitado a la hora exacta de la muestra gruesa, pero su
    exactitud sigue dependiendo de la trayectoria, EOP, máscara y modelo RF.

    No es un motor genérico de búsqueda de raíces: un pase que aparezca y
    desaparezca por completo entre dos muestras de exploración no queda
    encerrado y puede no detectarse. Reduzca el paso para ventanas muy cortas
    o máscaras/envolventes restrictivas.

## Estado

**No disponibles:** detección de eclipses, cruces de nodos, perigeo/apogeo,
maniobras, conjunciones, reentrada, eventos de iluminación o reglas de evento
definidas por el usuario.

## Referencias relacionadas

- [Tracking](tracking.md)
- [Modelos de la Tierra](../engineering/earth-models.md)
- [Cowell](../propagation/cowell.md)
