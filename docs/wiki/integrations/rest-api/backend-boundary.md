# REST API: frontera del backend

[Integraciones](../index.md) · [REST API](../rest-api.md) · [Arquitectura](../../development/architecture.md)

FastAPI implementa también `/catalog`, `/health`, `/reload` y exportaciones
internas. Salvo los destinos publicados por el gateway, no forman parte del
contrato de integración.

No configure clientes externos contra el puerto Python ni dependa de que
permanezca accesible fuera del contenedor. Consulte [Arquitectura](../../development/architecture.md)
para distinguir las tres capas de ejecución.
