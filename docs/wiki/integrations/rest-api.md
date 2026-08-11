# REST API

## Propósito y límite de red

La API HTTP de Orbit se sirve desde el mismo origen que la interfaz web. El
gateway Node.js expone las rutas públicas, conserva el catálogo y la
configuración, y reenvía las operaciones orbitales al proceso FastAPI privado.
La URL base es la del gateway, normalmente:

```text
http://127.0.0.1:8100
```

No existe un prefijo de versión, autenticación ni autorización. La API está
diseñada para una instalación local o una red controlada. Consulte
[Despliegue](../development/deployment.md) antes de publicar el puerto en una
red.

!!! warning "Contrato sin versionado público"

    Orbit no publica todavía una garantía de compatibilidad para clientes
    externos. Los consumidores deben validar el esquema contra
    [OpenAPI](openapi.md) en la instancia que vayan a usar y tolerar campos
    adicionales en las respuestas.

## Convenciones comunes

| Elemento | Contrato |
| --- | --- |
| Cuerpo | JSON salvo exportaciones de archivo. El gateway limita cuerpos JSON a 25 MB. |
| Fechas | Enviar ISO-8601 con zona horaria, preferiblemente `Z`/UTC. Las rutas orbitales normalizan sus instantes a UTC. |
| Identificador de satélite | `sat_id` y `:satId` se resuelven contra el nombre/identificador cargado en el catálogo. La codificación URL es responsabilidad del cliente. |
| Fuente orbital | Las rutas de catálogo aceptan un `sat_id` **o** ambas líneas `line1` y `line2` de un TLE. `POST /api/aos-los` admite además una definición manual explícita en `source`; no la registra en el catálogo. |
| Estados cartesianos | Cuando la respuesta incluye unidades, la representación para renderizado declara `reference_frame: "ITRF"`, posición en metros y velocidad en m/s. Las fuentes y productos de precisión mantienen contratos de marco y escala más explícitos internamente. |
| Errores del gateway | Un JSON inválido devuelve `400`; un cuerpo excesivo, `413`; un fallo al acceder al backend Python, `502` con `{ "ok": false, "error": "…" }`. |
| Errores de validación FastAPI | Las formas o valores inválidos devuelven normalmente `422`; una fuente no encontrada puede devolver `404`. |

Las consultas reenviadas al backend tienen un tiempo máximo de 30 segundos en
el gateway. La respuesta del backend conserva su estado HTTP y tipo de
contenido cuando el reenvío tiene éxito.

## Áreas de la API

| Área | Contenido |
| --- | --- |
| [Estado, configuración y catálogo](rest-api/system-and-catalog.md) | Healthcheck, configuración persistente, documentación y catálogo. |
| [Propagación y efemérides](rest-api/orbit-operations.md) | TLE, productos GNSS precisos con SP3/CLK/ERP/SUM/ATT/OSB, series temporales, parámetros y órbitas manuales. |
| [Estaciones de tierra](rest-api/ground-stations.md) | AOS/LOS y límites de la geometría de pases. |
| [Exportación](rest-api/exports.md) | TLE, OMM, OEM, OCM y efemérides exportadas. |
| [Frontera del backend](rest-api/backend-boundary.md) | Rutas privadas que no son contrato público. |

## Referencias relacionadas

- [OpenAPI y Swagger](openapi.md)
- [WebSocket](websocket.md)
- [Arquitectura](../development/architecture.md)
- [Validación](../development/validation.md)
