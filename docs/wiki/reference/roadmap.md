# Roadmap

## Estado de planificación

No hay un roadmap público aprobado, una lista de hitos con fechas ni una
priorización de producto verificable en el repositorio. Por tanto, Orbit no
publica compromisos de entrega, fechas estimadas ni garantías de que una
capacidad ausente vaya a incorporarse.

Esta página separa el alcance disponible de las ausencias verificables para
evitar que la arquitectura extensible se interprete como una promesa.

## Capacidades con implementación verificable

| Área | Estado actual | Referencia |
| --- | --- | --- |
| Gateway local HTTP/WebSocket | Implementado. | [Integraciones](../integrations/index.md) |
| Propagación TLE SGP4 | Implementada con estado nativo TEME. | [Glosario](glossary.md) |
| Órbitas manuales | Dos cuerpos, SGP4 sintético y Cowell/RK4 con fuerzas limitadas. | [REST API](../integrations/rest-api.md) |
| Tiempo y marcos explícitos | Módulos de EOP, leap seconds, `StateVector` y transformaciones. | [Arquitectura](../development/architecture.md) |
| Lectores OEM/SP3 Python | Implementados como módulos de backend. | [Validación](../development/validation.md) |
| Docker Compose local | Implementado. | [Despliegue](../development/deployment.md) |

## Capacidades no disponibles

| Capacidad | Estado verificable | No debe inferirse |
| --- | --- | --- |
| SDK Python distribuido | No existe paquete ni contrato público. | Que `orbit_api` sea un SDK soportado. |
| CLI de producto | No existe ejecutable ni especificación de comandos. | Que los scripts Windows sean una CLI estable. |
| Plugins instalables | No existe instalación, manifiesto o marketplace. | Que `PluginHost` permita extensiones de terceros. |
| Autenticación y autorización | No implementadas. | Que una API expuesta sea segura por defecto. |
| Colaboración/multitenencia | No implementada. | Que los proyectos se sincronicen entre usuarios. |
| Determinación de órbita | No implementada. | Que los elementos osculadores sean una solución OD. |
| Carga operativa OEM/SP3 de precisión | No expuesta por UI, gateway o API pública. | Que el lector Python implique una ruta de producto. |
| CI, artefactos y releases automatizados | No declarados. | Que los comandos locales publiquen una release. |
| Kubernetes/Helm/cloud gestionado | No incluido. | Que Docker Compose describa un despliegue multiinstancia. |

## Criterio para publicar una iniciativa futura

Una capacidad sólo debería aparecer como iniciativa de roadmap si existe una
decisión de producto trazable. Antes de anunciarla, debe especificarse:

1. Problema y usuario objetivo.
2. Contrato de entrada/salida, seguridad y persistencia.
3. Marcos, escalas temporales, unidades, datos auxiliares y precisión si es
   numérica.
4. Límites de rendimiento, capacidad y error.
5. Compatibilidad con proyectos, API y configuración existentes.
6. Plan de pruebas, documentación y operación.
7. Responsable, versión objetivo y criterio de aceptación.

Sin esos elementos, una idea, una nota de trabajo o un módulo interno no constituye un compromiso
de roadmap.

## Relación con notas de versión

[Notas de versión](release-notes.md) describe cambios identificables que ya
existen en el historial. Esta página no convierte las ausencias del producto en
compromisos futuros ni extrapola fechas a partir de los commits anteriores.

## Referencias relacionadas

- [Notas de versión](release-notes.md)
- [SDK Python](../integrations/python-sdk.md)
- [CLI](../integrations/cli.md)
- [Plugins](../integrations/plugins.md)
