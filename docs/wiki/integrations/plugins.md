# Plugins

## Estado actual

Orbit **no tiene un host de plugins ni un runtime de plugins**. No existe una
clase `PluginHost` activa, un registro de extensiones, un manifiesto ni una API
para que código externo participe en el proceso de la aplicación.

Las funcionalidades actuales se integran como módulos normales del repositorio,
se revisan junto con el resto del código y se cargan desde las entradas de
frontend, gateway o backend que les correspondan. Esto no constituye un sistema
de extensiones.

| Capacidad | Estado actual |
| --- | --- |
| Host y ciclo de vida de plugins | No implementado. |
| Registro de plugins en el runtime | No implementado. |
| API pública de frontend o backend para plugins | No publicada. |
| Manifiesto, versiones, compatibilidad o marketplace | No implementado. |
| Instalación mediante UI, CLI, npm o pip | No disponible. |
| Carga de código remoto en el navegador | No disponible. |

!!! warning "No existe una API de extensibilidad"

    No se debe importar un módulo interno como si fuera un plugin soportado.
    Las rutas, eventos, estructuras de configuración y contratos internos
    pueden cambiar sin promesa de compatibilidad para extensiones.

## Hoja de ruta de extensibilidad

Un sistema de plugins solo se considerará cuando exista una decisión de producto
y se definan, como mínimo, los siguientes contratos:

1. Un host integrado en el arranque y apagado del runtime, con activación y
   limpieza deterministas.
2. Un contexto explícito y versionado para dependencias como Cesium, servicios,
   eventos y espacios de interfaz.
3. Identidad, manifiesto, compatibilidad y política de actualización de cada
   extensión.
4. Límites de seguridad: no se descargará ni ejecutará código arbitrario en el
   navegador.
5. Persistencia, migración de proyectos, observabilidad y pruebas de ciclo de
   vida antes de exponer cualquier punto de extensión.

Hasta entonces, extraer un dominio a un módulo con pruebas es una mejora de
arquitectura interna, no un plugin instalable.

## Alternativas disponibles hoy

- Para interoperar con Orbit, use las interfaces locales [REST API](rest-api.md),
  [WebSocket](websocket.md) y [OpenAPI](openapi.md).
- Para contribuir al producto, añada código al dominio adecuado del repositorio
  y valide su comportamiento con las pruebas correspondientes.

## Referencias relacionadas

- [Arquitectura](../development/architecture.md)
- [Contribuir](../development/contributing.md)
- [Hoja de ruta](../reference/roadmap.md)
