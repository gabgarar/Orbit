# Sistemas de coordenadas

[Inicio](../index.md) · [Ingeniería](index.md) · [Estados cartesianos](cartesian-states.md) · [Marcos de referencia](reference-frames.md)

## Alcance implementado

Orbit usa coordenadas cartesianas tridimensionales para estados orbitales.
Los ejes y el origen se definen por el marco de referencia declarado, no por
la palabra "coordenadas". El centro de los estados transformables es la Tierra.

| Tipo | Estado | Convención |
| --- | --- | --- |
| Cartesiano geocéntrico | Disponible | \((x,y,z)\) en m; \((v_x,v_y,v_z)\) en m/s. |
| Cartesiano de trabajo interno de propagadores | Disponible | km y km/s únicamente dentro de los motores; se convierte en la frontera. |
| Geodésico WGS-84 | Parcial e interno | Solo se usa para estimar altura en el drag de Cowell. |
| Topocéntrico ENU/NED | No disponible como contrato orbital | No hay transformador de estados ni formato de salida general. |
| RSW/RTN/TNW | No disponible | Se rechazan como marcos de covarianza OEM locales. |

## Ejes y origen

El significado de los ejes depende del marco. Por ejemplo, `TEME` no es
intercambiable con `GCRF`, y `ITRF` no equivale a una etiqueta genérica
"Earth-fixed". Consulte la tabla de rutas en
[Marcos de referencia](reference-frames.md).

`StateVector.center` se normaliza a mayúsculas. El transformador incorporado
rechaza cambios de marco para centros distintos de `EARTH`; no realiza
traducciones baricéntricas ni planetocéntricas.

## Altitud usada por Cowell

Cuando se habilita arrastre, Cowell estima altura geodésica mediante el
elipsoide WGS-84 y usa esa altura para seleccionar una capa de la atmósfera
exponencial. Esta operación no convierte el estado nativo `EME2000` en un
estado terrestre completo ni implementa una API geodésica.

## Unidades

| Frontera | Posición | Velocidad | Aceleración |
| --- | --- | --- | --- |
| `StateVector` | m | m/s | m/s² |
| SGP4 y elementos clásicos internos | km | km/s | — |
| OEM de texto | km | km/s | km/s² cuando la versión permite aceleración |
| SP3 de texto | km | dm/s en registros `V` | — |

!!! note "Conversión de unidades no es transformación de marco"

    Pasar de km a m conserva las coordenadas. Pasar de TEME a ITRF exige una
    transformación dependiente del tiempo y EOP.
