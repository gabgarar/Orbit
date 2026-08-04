# Servicio orbital

## Visión general

El servicio Python valida el dominio orbital, adapta formatos, propaga, transforma marcos y ofrece primitivas de análisis. Se alcanza a través del gateway, nunca como servidor público independiente.

## Formatos

| Formato | Contrato |
| --- | --- |
| TLE | Entrada SGP4; marco nativo TEME. |
| OMM / OPM | Intercambio de elementos y parámetros orbitales. |
| OEM | Efemérides cartesianas con marco, escala y covarianza por segmento. |
| SP3 | Preparado para ingestión precisa; la realización terrestre será explícita. |
| CPF / RINEX | Cobertura declarada como soportada, parcial o no soportada. |

Un segmento OEM mantiene su escala y marco. La covarianza debe poder convertirse al marco del estado; si no, la importación falla antes de relabelar datos de forma insegura.

## Catálogo, análisis y exportación

El servicio inspecciona registros, crea órbitas manuales, analiza y genera salidas conscientes del formato. Comparación de propagadores, gráficas, estadísticas, eventos, medidas, tracking y alcance de OD conservan identidad de estado, época y transformaciones aplicadas.

## Límites

- SP3 y OEM de alta fidelidad no se degradan a semántica TLE.
- No se anuncia precisión, datum o modelo de fuerzas que el origen no haya establecido.
- Los formatos no soportados siguen siendo límites explícitos.

## Siguientes destinos

<div class="grid cards" markdown>

- :material-api: **Integrar mediante API**

  Contratos HTTP, WebSocket y errores explícitos.

  [Ir a la API →](api.md)

- :material-layers-triple: **Visualizar resultados**

  Capas, proyectos, modos temporales y visor 3D.

  [Ir al espacio de trabajo →](workspace.md)

</div>
