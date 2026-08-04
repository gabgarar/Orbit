# Referencia API

## Visión general

La integración pública pasa por HTTP en el gateway. WebSocket entrega snapshots de espacio de trabajo con semántica de mejor esfuerzo.

## Contratos

Las solicitudes se validan antes de llegar a propagadores o adaptadores. Se documentan juntos los campos canónicos y `camelCase` heredado cuando la compatibilidad lo necesita. Las respuestas conservan marco nativo, ruta de transformación, calidad EOP e identidad de datos fijados.

## Áreas HTTP

| Área | Responsabilidad |
| --- | --- |
| Sistema y catálogo | Salud, ajustes, registros e importación. |
| Operaciones orbitales | Propagación, estado nativo, efemérides y parámetros. |
| Estaciones | Geometría de estaciones y operaciones por marco. |
| Exportación | Resultados y respuestas conscientes del formato. |
| Frontera backend | Contrato Node→Python declarado. |

```json
{"epoch":"2026-07-25T12:00:00Z", "targetFrame":"ITRF2020", "strict":true}
```

El OpenAPI real define endpoint y esquema exactos; el ejemplo solo muestra intención.

## Límites

- Errores de entrada son explícitos, no fallbacks silenciosos.
- WebSocket no garantiza entrega ni conservación de cada snapshot.
- El puerto Python es privado y no forma parte de la API soportada.
