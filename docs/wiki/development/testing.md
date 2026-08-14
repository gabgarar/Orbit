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
| Integración con productos públicos | `server/python/tests/integration/` | `pytest` con caché validada | `./.scripts/test-real-data.ps1 -Download` (explícito). |
| Rendimiento con datos reales | Tests marcados `performance` | `pytest` y reloj monotónico | `./.scripts/test-real-data.ps1 -Download -Performance` (explícito). |

Las pruebas Python cubren rutas FastAPI, solicitudes, runtime, propagadores,
estaciones, cachés, formatos OEM/SP3, marcos, realizaciones, EOP y escalas de
tiempo. Los tests Node cubren el gateway, repositorios, catálogo, proxy y
contratos de despliegue. La existencia de pruebas no implica cobertura total ni
una certificación de precisión orbital.

## Pruebas unitarias, integración y rendimiento

La suite normal está formada por pruebas unitarias y de contrato con fixtures
locales sintéticos o versionados. Cubre, entre otros, invariantes de Kepler,
solución de Kepler de alta excentricidad, gravedad central y armónicos,
terceros cuerpos, SRP, continuidad Hermite, escalas de tiempo, ERP/EOP,
transformaciones de marcos, SP3/OEM y Master Time Range. No abre una conexión
de red: por ello es la evidencia que se exige en cada `push` y `pull request`.

Las pruebas de integración con productos reales son una segunda capa opt-in.
Comprueban el contrato completo de un bundle público SP3+ERP: procedencia,
hash o validación de contenido aplicable, cobertura temporal, análisis SP3,
interpolación y transformaciones que la implementación admite. La caché se
guarda en `data/test-real-data/`, que no se versiona. Un artefacto corrupto o
incompleto se rechaza y no cuenta como una ejecución válida.

El bundle inmutable actual es el par CODE MGEX de 2025-131 (SP3 y ERP), con
SHA-256 fijado para los bytes comprimidos. Se busca primero el par equivalente
en `../SP3`; si falta, `-Download` lo obtiene por HTTPS desde el host permitido
de CODE, lo valida y lo publica de forma atómica en la caché. La opción
`-IncludeIers` añade C01 de IERS como una comprobación separada: su endpoint
`latestVersion` es mutable, por lo que se valida formato, límites y SHA-256
local registrado, pero no se presenta como un snapshot reproducible fijado.

Las mediciones de rendimiento también son opt-in. Informan el tiempo observado
en el equipo que las ejecuta y pueden aplicar un presupuesto explícito con
`ORBIT_REAL_DATA_PERF_MAX_SECONDS`; no constituyen una promesa de que cualquier
CPU, runner hospedado, GPU o configuración de misión alcance la misma cifra.

No se simula evidencia externa inexistente: la suite no invoca STK ni GMAT, no
descarga ni valida JPL DE430, y no afirma soporte de MSISE-00 o NRLMSISE-00
mientras esos modelos no estén implementados. Si una capacidad opcional no está
disponible —por ejemplo, un campo EGM2008 2190×2190 local— el resultado se
marca `skipped` con el motivo, no como éxito científico.

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

La validación de datos públicos no se ejecuta desde `test-all`, porque una
descarga de red no debe convertir el test diario en no determinista. Ejecútela
de forma consciente cuando se necesite ampliar la evidencia:

```powershell
# Usa primero un SP3 local en ../SP3 si existe; si no, descarga el bundle
# público permitido, lo valida y lo deja en data/test-real-data/.
.\.scripts\test-real-data.ps1 -Download

# Añade las mediciones de rendimiento con el mismo bundle validado.
.\.scripts\test-real-data.ps1 -Download -Performance

# Opcional: valida y registra la C01 mutable; no la convierte en una referencia
# de misión fijada por hash de origen.
.\.scripts\test-real-data.ps1 -Download -IncludeIers

# Ejemplo de presupuesto específico del equipo, en segundos.
$env:ORBIT_REAL_DATA_PERF_MAX_SECONDS = "5"
.\.scripts\test-real-data.ps1 -Download -Performance
```

`ORBIT_RUN_REAL_DATA=1` habilita esta capa; `ORBIT_DOWNLOAD_REAL_DATA=1`
autoriza una descarga ante una caché vacía. Sin esas variables, las pruebas de
datos reales se saltan deliberadamente e informan la capacidad ausente. Se
puede forzar una fuente local con `ORBIT_REAL_DATA_DIR` y cambiar el destino
persistente con `ORBIT_REAL_DATA_CACHE`.

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

## Integración continua

GitHub Actions aplica tres barreras reproducibles:

| Workflow | Cuándo se ejecuta | Evidencia que produce |
| --- | --- | --- |
| `quality.yml` (**Orbit quality**) | Cada `push` y `pull request`. | Tests Node y frontend (incluido MTR), build React, contratos ITRF/ECI, EOP/ERP, SP3/OEM, interpolación, propagadores y fuerzas; suite Python completa; auditoría Knip/ESLint/Ruff/Vulture; build MkDocs estricto. |
| `docs-pages.yml` (**Deploy documentation**) | Pull requests que cambian la documentación y pushes a `main`. | Construye las dos traducciones con `mkdocs build --strict`, comprueba las páginas de inicio generadas y publica GitHub Pages sólo tras un push a `main`. |
| `release.yml` (**Release Orbit**) | Tags `vMAJOR.MINOR.PATCH` y releases creadas desde un tag válido. | Build de Orbit Tracker, archivo reproducible, `SHA256SUMS.txt` verificado antes de adjuntarlo a la release. |
| `real-data.yml` (**Orbit real-data validation**) | Sólo `workflow_dispatch`; se inicia manualmente. | Restaura o descarga el bundle público SP3/ERP, valida su contenido y ejecuta la integración; la medición de rendimiento se activa mediante su entrada `performance`. |

Los workflows usan las cachés de npm, pip o datos públicos de GitHub Actions. Las pruebas
de navegador siguen siendo un paso operativo separado porque requieren una
instancia Docker saludable; no se presentan como una comprobación remota que
pueda ejecutarse sin ese servicio.

La validación documental es local y determinista: navegación, páginas,
enlaces Markdown y anclas se convierten en errores mediante `--strict`. No
sondea URLs externas durante CI, porque su disponibilidad no es propiedad del
repositorio ni haría reproducible el build.

`quality.yml` fija expresamente las variables de datos reales y rendimiento a
`0`. Así, un `push` o PR no puede activar por accidente una descarga externa;
la caché de productos públicos se usa sólo en el workflow manual, donde se
valida antes de cada uso.

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
| Cambio en parser SP3/ERP, caché de datos o contrato de integración | Suite offline más `test-real-data.ps1 -Download`; añada `-Performance` sólo si afecta al coste. |
| React, Vite, Cesium o assets runtime | `test:react-build`, pruebas frontend y, si cambia interacción visible, UI. |
| Docker, Compose o scripts de operación | Pruebas de contrato de despliegue, build Docker y healthcheck. |
| Cambio transversal | `test-all` más una revisión de los contratos REST/WebSocket afectados. |

## Límites de automatización

CI bloquea la integración si falla una prueba o build declarado, pero no es una
certificación de precisión de misión ni sustituye una revisión científica de
datos, marcos, escalas de tiempo o modelos de fuerza. Tampoco se publica aún
una métrica de cobertura, un umbral de cobertura ni una matriz de navegadores
soportados; no deben inferirse de los comandos existentes.

`release.yml` no crea una versión para cada commit: sólo empaqueta y publica
cuando el tag tiene el formato SemVer `vMAJOR.MINOR.PATCH` (con metadatos
SemVer opcionales). Antes de crear un tag conviene comprobar que **Orbit
quality** está verde en el commit exacto que se va a etiquetar.

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
