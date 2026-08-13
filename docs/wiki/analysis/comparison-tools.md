# Comparación de propagadores

[Análisis](index.md){ .md-button } [Propagación](../propagation/overview.md){ .md-button }

Orbit dispone de una base de cálculo **interna y sin interfaz** para una futura
comparación de propagadores. No hay todavía una ventana, endpoint HTTP ni tabla
pública: el contrato se expone únicamente como el servicio Python
`compare_trajectories(...)`. Esta separación evita que una visualización o una
conversión implícita determine el resultado científico.

## Contrato seguro

Cada entrada es una secuencia de `StateVector`. Un `StateVector` ya declara
componentes cartesianas SI, época con zona horaria, escala temporal, centro y
marco no ambiguo. El comparador exige lo siguiente antes de calcular un solo
error:

| Campo | Regla |
| --- | --- |
| Unidades | Posición en **m** y velocidad en **m/s**; no acepta tuplas de renderer ni km sin tipar. |
| Épocas | Igual número de muestras, orden estrictamente creciente y la misma época exacta en ambas series. |
| Marco | Mismo marco **y realización** (por ejemplo, no mezcla ITRF con ITRF2020). |
| Tiempo | Misma escala temporal declarada; no convierte GPS, UTC o UT1 dentro de la comparación. |
| Centro | Mismo centro, normalmente `EARTH`. |
| Velocidad | Ambas series la aportan completa o ambas son solo posición. No se silencian componentes ausentes. |

El comparador no transforma marcos, no interpola muestras y no descarga ERP,
EOP o segundos intercalares. Si se necesita ITRF→ECI, esa conversión debe
haberse completado y validado previamente con su ERP, ruta de realización y
datos temporales. De otro modo la operación se rechaza.
También rechaza una resta vectorial que desborde el rango numérico: no publica
una métrica infinita como si fuera un resultado físico.

Los nombres de referencia y candidato son obligatorios para que el resultado
sea trazable. Los identificadores de modelo (`reference_model_id` y
`candidate_model_id`) son opcionales y solo documentan el origen: no hacen que
dos modelos matemáticamente distintos se vuelvan equivalentes.

!!! warning "No equivalencia de modelos"

    Un TLE interpretado por SGP4 no es el mismo objeto matemático que un
    estado osculante manual integrado por Cowell. Una diferencia entre ambos
    modelos no es, por sí misma, un error de propagación.

## Métricas y umbrales

Para cada época común se calcula la norma euclídea de la diferencia de
posición, en m, y —si existe velocidad— de velocidad, en m/s. El resultado
incluye por separado:

- media aritmética de los errores;
- RMS: `sqrt(media(error²))`;
- máximo;
- percentiles p50, p95 y p99 mediante interpolación lineal en el rango
  `(n - 1) × p / 100`;
- error por muestra y la primera superación de umbral.

Un umbral se supera únicamente si `error > umbral`. Un valor exactamente igual
permanece dentro del límite. Los umbrales deben ser finitos y mayores o iguales
a cero; uno de velocidad no puede declararse para trayectorias sin velocidad.

## Uso futuro del servicio

La futura UI/API deberá muestrear los propagadores en una misma malla y marco
ya validados, y pasar los estados al servicio:

```python
from orbit_api.application.propagator_comparison import compare_trajectories

result = compare_trajectories(
    reference_states,
    candidate_states,
    reference_name="SP3 IGS Final",
    candidate_name="Cowell RK4",
    reference_model_id="sp3",
    candidate_model_id="cowell-rk4",
    position_threshold_m=100.0,
    velocity_threshold_m_s=0.1,
)
```

La capa futura puede mostrar `result.samples`, `result.position` y
`result.velocity`, pero no debe alterar sus unidades, alineación o contrato.
Antes de publicar esa UI faltan selección de fuentes, malla temporal explícita,
transformación común autorizada, persistencia de configuración y presentación
de incertidumbre/verdad terreno.

## Referencias relacionadas

- [SGP4](../propagation/sgp4.md)
- [Dos cuerpos](../propagation/two-body.md)
- [Cowell](../propagation/cowell.md)
- [Sistemas de coordenadas](../engineering/coordinate-systems.md)
