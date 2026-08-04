# Desarrollo

Esta sección describe la estructura que se encuentra en el repositorio y las
prácticas necesarias para modificarla sin mezclar responsabilidades de
interfaz, gateway, cálculo orbital y datos persistentes.

| Página | Contenido |
| --- | --- |
| [Arquitectura](architecture.md) | Procesos, módulos, límites de responsabilidad y flujo de datos. |
| [Testing](testing.md) | Capas de prueba, comandos y artefactos. |
| [Validación](validation.md) | Validación de entrada, contratos numéricos y configuración estricta. |
| [Contribuir](contributing.md) | Reglas de mantenimiento y verificación de cambios. |
| [Despliegue](deployment.md) | Imagen Docker, Compose, persistencia y operación local. |

## Principio de mantenimiento

Un cambio debe conservar de forma explícita el marco de referencia, la escala
temporal, las unidades y la procedencia cuando alcance datos orbitales. La
interfaz no debe inventar esos atributos, y los módulos numéricos no deben
adquirir datos remotos durante una transformación.

## Interfaces relacionadas

- [REST API](../integrations/rest-api.md)
- [WebSocket](../integrations/websocket.md)
- [Glosario](../reference/glossary.md)
- [Bibliografía](../reference/bibliography.md)
