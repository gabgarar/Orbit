# CLI

## Estado

Orbit no proporciona una interfaz de línea de comandos de producto.

No existe un ejecutable `orbit`, un subcomando para propagación, una interfaz
de automatización versionada ni una especificación de argumentos y códigos de
salida para usuarios externos. Las operaciones de producto se realizan desde
la aplicación web o mediante la [REST API](rest-api.md).

## Comandos existentes en el repositorio

El repositorio incluye scripts de PowerShell y archivos `.cmd` orientados a la
operación local en Windows, además de scripts npm para desarrollo. Son
herramientas del repositorio, no una CLI pública ni un SDK.

| Acción | Interfaz existente |
| --- | --- |
| Reiniciar y comprobar Orbit con Docker | `./.scripts/restart-orbit.cmd` o `.ps1`. |
| Ver estado y healthcheck | `./.scripts/orbit-status.cmd` o `.ps1`. |
| Seguir logs del contenedor | `./.scripts/orbit-logs.cmd` o `.ps1`. |
| Ejecutar pruebas Node, frontend, backend o UI | Scripts `test-*.cmd`/`.ps1` y comandos npm descritos en [Testing](../development/testing.md). |
| Arrancar el gateway durante desarrollo | `npm run start --prefix server`, tras compilar `react-ui`. |
| Generar teselas locales de la textura terrestre | `npm run tiles:earth2km --prefix server`. |

Los scripts Windows comprueban dependencias como Docker o npm y algunos
reinician el contenedor antes de ejecutar su tarea. No deben incorporarse a un
pipeline de automatización externo sin revisar sus efectos operativos.

## Límites explícitos

- No hay un comando de línea de órdenes soportado para importar TLE, propagar
  una órbita, crear un proyecto o exportar una efeméride.
- No hay CLI para instalar, listar o actualizar plugins.
- No hay autenticación ni configuración de credenciales de API mediante CLI.
- Los comandos npm describen el árbol de desarrollo actual y pueden cambiar
  junto con el código fuente.

## Referencias relacionadas

- [Despliegue](../development/deployment.md)
- [Testing](../development/testing.md)
- [REST API](rest-api.md)
