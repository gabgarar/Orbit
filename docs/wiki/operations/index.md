# Operación

[Inicio](../index.md) · [Instalación](../getting-started/installation.md) · [Guía de usuario](../user-guide/index.md)

Esta sección cubre la operación local del runtime, la configuración persistente,
los datos temporales para transformaciones terrestres y los ajustes que afectan
al coste de visualización. No describe una plataforma de administración
multiusuario ni un servicio gestionado.

## Páginas operativas

| Página | Alcance |
| --- | --- |
| [Configuración](configuration.md) | Archivo persistente, panel de configuración, catálogo y variables de ejecución. |
| [Tiempo y EOP](time-eop.md) | Caché C01 automática, snapshots C04, segundos intercalares, UT1, ITRF y modo estricto. |
| [Rendimiento](performance.md) | Ajustes de presentación y frecuencia que cambian el coste del runtime. |
| [Validación](validation.md) | Healthcheck, suites automatizadas y validación de datos de operación. |
| [Preguntas frecuentes](faq.md) | Respuestas a límites y comportamientos operativos verificados. |

## Límites de operación

- Orbit se ejecuta como un gateway local Node.js con un backend Python privado.
  El gateway es el extremo HTTP expuesto por Compose.
- La carpeta config/ es persistente en el despliegue Docker estándar. Proteja
  sus copias y aplique control de versiones o backups fuera del runtime.
- No hay autenticación, autorización, gestión de secretos, multitenencia ni
  registro de auditoría de producto.
- No se descargan datos EOP durante una transformación. La actualización de
  precisión se realiza mediante archivos locales y reinicio explícito.

Para construir o reiniciar el servicio, siga [Instalación](../getting-started/installation.md).
