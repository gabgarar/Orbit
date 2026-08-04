# OpenAPI, Swagger y ReDoc

## Endpoints de documentación

El backend FastAPI genera su documento OpenAPI durante el arranque. El gateway
lo publica en el mismo origen que la interfaz:

| Recurso | Ruta pública |
| --- | --- |
| Documento OpenAPI JSON | `/openapi.json` |
| Swagger UI | `/docs` |
| ReDoc | `/redoc` |

La aplicación FastAPI se identifica actualmente como `Orbit Propagation API`
con versión interna `0.1.0`. Esa cadena describe la configuración del backend,
no una promesa de versionado estable para integradores externos.

## Uso del documento

El documento es la fuente de detalle de los esquemas Pydantic que respaldan
las rutas FastAPI: campos requeridos, formatos, límites y respuestas de
validación. Debe consultarse en la instancia concreta antes de generar un
cliente o fijar un contrato.

```text
http://127.0.0.1:8100/openapi.json
```

El gateway expone Swagger y ReDoc mediante proxy. Si el backend Python no está
disponible, estas rutas no sustituyen al healthcheck del gateway ni garantizan
que las operaciones orbitales estén disponibles.

## Alcance del documento generado

OpenAPI describe las rutas FastAPI incluidas en la aplicación: propagación,
órbitas, efemérides, estaciones, órbitas manuales, parámetros orbitales y
algunas operaciones de sistema. El gateway añade rutas propias de catálogo,
importación, refresco, configuración y exportación que no se generan desde
FastAPI y, por tanto, no están cubiertas completamente por `/openapi.json`.

De forma inversa, algunas rutas FastAPI internas no se reenvían como interfaz
pública del gateway. Una operación publicada requiere que esté presente en el
documento OpenAPI **y** que su ruta sea expuesta por el gateway. La tabla de
[REST API](rest-api.md) identifica ese límite.

## Restricciones de generación de clientes

No hay cliente OpenAPI generado, SDK distribuido, autenticación de esquema ni
política de breaking changes. La generación de un cliente externo debe
considerarse una integración local mantenida por su propietario.

Antes de usar un cliente generado:

1. Obtener el documento desde la instancia destino.
2. Comprobar que la ruta se publique por el gateway.
3. Enviar fechas con zona horaria y conservar los campos de marco, unidades y
   escala temporal de las respuestas.
4. Tratar respuestas `422`, `502` y `503` como resultados operativos
   recuperables, no como excepciones de transporte indistinguibles.

## Referencias relacionadas

- [REST API](rest-api.md)
- [SDK Python](python-sdk.md)
- [Validación](../development/validation.md)
