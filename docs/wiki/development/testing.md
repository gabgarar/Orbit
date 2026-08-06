# Testing

## Objetivo

Orbit verifica de forma separada el gateway, los módulos de interfaz, la
compilación React, el backend Python y la interfaz ejecutada en un navegador.
Las pruebas no sustituyen la validación científica de un producto de misión:
validan los contratos implementados, sus límites y sus regresiones conocidas.

## Matriz de pruebas

| Capa | Ubicación | Herramienta | Comando principal |
| --- | --- | --- | --- |
| Gateway Node.js | `server/tests/node/` | `node --test` | `npm run test:node --prefix server` |
| Módulos frontend heredados | `front/tests/unit/` | `node --test` | `npm run test:frontend --prefix server` |
| Build React/Vite | `react-ui/` | Vite y validación de assets locales | `npm run test:react-build --prefix server` |
| Backend Python | `server/python/tests/` | `pytest` | `npm run test:backend --prefix server` o script Docker Windows. |
| Interfaz de navegador | `tests/ui/` | Playwright | `npm run test:integration --prefix server` con Orbit ya saludable. |

Las pruebas Python cubren rutas FastAPI, solicitudes, runtime, propagadores,
estaciones, cachés, formatos OEM/SP3, marcos, realizaciones, EOP y escalas de
tiempo. Los tests Node cubren el gateway, repositorios, catálogo, proxy y
contratos de despliegue. La existencia de pruebas no implica cobertura total ni
una certificación de precisión orbital.

## Ejecución en Windows

Los scripts `.cmd` y `.ps1` centralizan la ruta reproducible con Docker:

```powershell
.\.scripts\test-node.cmd
.\.scripts\test-frontend.cmd
.\.scripts\test-react-build.cmd
.\.scripts\test-backend.cmd
.\.scripts\test-ui.cmd
.\.scripts\test-all.cmd
```

`test-backend` reinicia Orbit y ejecuta `pytest` dentro del contenedor.
`test-ui` reinicia y espera el healthcheck antes de lanzar Playwright. La
secuencia de `test-all` es Node, frontend heredado, build React, backend Python
y UI.

## Ejecución desde npm

Desde la raíz del repositorio:

```bash
npm run test:node --prefix server
npm run test:frontend --prefix server
npm run test:react-build --prefix server
npm run test:backend --prefix server
npm run test:integration --prefix server
```

`npm run test:backend --prefix server` usa `python3` y requiere un entorno con
las dependencias de `server/requirements.txt`. El script Windows equivalente
usa Docker para ejecutar el mismo árbol de pruebas en la imagen de Orbit.

## Auditoría estática

La auditoría de código busca imports, variables, exports y ficheros sin uso
antes de eliminar código. Ejecuta Knip para Node, React y el runtime heredado;
ESLint para JavaScript; y Ruff/Vulture para el backend Python:

```powershell
.\.scripts\audit-code.ps1
```

La primera vez, instala las herramientas Python en el entorno virtual:

```powershell
.\.venv\Scripts\python.exe -m pip install -r server\requirements-dev.txt
```

Las herramientas son una señal de revisión, no autorizan por sí solas a borrar
una API: un export puede ser consumido por otra capa o constituir un contrato
documentado.

## Pruebas de interfaz

Playwright usa por defecto `http://127.0.0.1:8100`, un worker y un timeout de
60 segundos por prueba. Se puede cambiar la instancia destino mediante
`ORBIT_UI_BASE_URL`. La suite es serial porque los flujos de proyecto y
catálogo comparten estado persistente.

```powershell
$env:ORBIT_UI_BASE_URL = "http://127.0.0.1:18100"
npm run test:ui --prefix server
```

Los resultados se guardan en `tests/artifacts/ui-results/`; el informe HTML se
genera en `tests/artifacts/ui-report/`. Las capturas y trazas se retienen al
fallar una prueba.

## Validación durante la imagen Docker

El `Dockerfile` instala dependencias Node y Python, ejecuta pruebas Node,
frontend y Python, y después compila la distribución React. Las pruebas de
navegador no forman parte de esa fase de build: requieren una instancia Orbit
saludable y se ejecutan mediante Playwright por separado.

## Selección de pruebas por cambio

| Cambio | Verificación mínima |
| --- | --- |
| Rutas Express, proxy o catálogo | `test:node` y pruebas específicas de catálogo/proxy. |
| Modelo Pydantic, propagador, formato, marcos o tiempo | `pytest server/python/tests` y las pruebas de contrato afectadas. |
| React, Vite, Cesium o assets runtime | `test:react-build`, pruebas frontend y, si cambia interacción visible, UI. |
| Docker, Compose o scripts de operación | Pruebas de contrato de despliegue, build Docker y healthcheck. |
| Cambio transversal | `test-all` más una revisión de los contratos REST/WebSocket afectados. |

## Limitaciones de automatización

No hay configuración de integración continua declarada en el repositorio
(por ejemplo, no hay workflows de GitHub Actions). La ejecución de pruebas y
la publicación de resultados dependen del entorno que mantenga la instancia.

No se publica una métrica de cobertura, un umbral de cobertura ni una matriz
de navegadores soportados. No deben inferirse de los comandos existentes.

## Buenas prácticas

1. Reproducir un fallo con la prueba más pequeña que lo exprese.
2. Añadir una prueba de límite cuando se modifique validación, muestras,
   transformaciones de tiempo o caché.
3. Evitar fixtures que oculten un marco, una escala temporal o unidades.
4. Ejecutar el build React cuando se modifiquen assets que deben estar offline.
5. Revisar los artefactos Playwright antes de aceptar un cambio visual.

## Referencias relacionadas

- [Validación](validation.md)
- [Contribuir](contributing.md)
- [Despliegue](deployment.md)
