# SDK Python

## Estado

Orbit no distribuye un SDK Python público.

No hay paquete publicable, índice de paquetes, `pyproject.toml`, documentación
de instalación, versión semántica de SDK ni política de compatibilidad para
consumidores externos. Por tanto, no debe instalarse ni anunciarse un paquete
denominado `orbit` u `orbit_api` como interfaz soportada de Orbit.

## Código Python incluido en el repositorio

El árbol `server/python/orbit_api/` contiene la implementación privada del
backend FastAPI. Sus módulos cubren, entre otros, propagación, marcos,
timekeeping, formatos tabulares, rutas HTTP y caché. Estos imports existen
para componer el runtime de Orbit y para ejecutar sus pruebas; no constituyen
un SDK.

| Necesidad | Vía soportada actualmente |
| --- | --- |
| Propagar u obtener una efeméride desde otra aplicación local | [REST API](rest-api.md) mediante el gateway. |
| Consultar el esquema de operaciones orbitales | [OpenAPI](openapi.md) de la instancia activa. |
| Recibir actualizaciones de capas suscritas | [WebSocket](websocket.md). |
| Contribuir al backend | Código fuente del repositorio y [Contribuir](../development/contributing.md). |

!!! warning "Imports internos"

    Importar directamente `orbit_api` desde un proceso externo acopla ese
    proceso a rutas, dependencias y contratos no versionados. No hay garantía
    de estabilidad de nombres, firmas, tipos ni comportamiento fuera del
    runtime que arranca Orbit.

## Requisitos para un SDK futuro

No existe una propuesta aprobada ni una fecha de publicación. Un SDK público
requeriría, como mínimo, una distribución versionada, contratos de transporte
o de dominio estables, política de compatibilidad, gestión explícita de
datos EOP/segundos intercalares, ejemplos reproducibles y una matriz de
pruebas independiente del proceso de Orbit. Esta lista no anuncia que tales
capacidades estén planificadas.

## Referencias relacionadas

- [REST API](rest-api.md)
- [OpenAPI](openapi.md)
- [Roadmap](../reference/roadmap.md)
