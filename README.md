# Orbit

La documentación oficial de Orbit está organizada para Material for MkDocs en
[docs/wiki/](docs/wiki/index.md). La operación reproducible de tiempo, EOP e
ITRF se documenta en [Tiempo, EOP e ITRF](docs/wiki/operations/time-eop.md).

## Ejecutar en local (recomendado: Docker)

El proyecto incluye un entorno reproducible para Windows, macOS, Linux y despliegues en la nube. Instala [Docker Desktop](https://www.docker.com/products/docker-desktop/) y, desde la raíz del repositorio, ejecuta:

```bash
docker compose up --build
```

Abre `http://localhost:8100`. Para detenerlo, usa `Ctrl+C`; para dejarlo en segundo plano:

```bash
docker compose up -d --build
```

Por defecto Docker publica Orbit solo en `127.0.0.1`, por lo que no queda accesible desde otros equipos de la red. Para exponerlo deliberadamente, establece `ORBIT_HTTP_BIND=0.0.0.0` junto al comando de Compose (en PowerShell: `$env:ORBIT_HTTP_BIND = "0.0.0.0"`). Ese valor publica el puerto en todas las interfaces de red; mantenlo en `127.0.0.1` para el uso local habitual. Si se publica fuera de una red de confianza, protégelo mediante firewall o un proxy con autenticación: las rutas de administración de Orbit están pensadas para un entorno controlado.

Si el puerto `8100` del equipo ya estÃ¡ ocupado, cambia sÃ³lo el puerto publicado: `ORBIT_HTTP_PORT=18100 docker compose up --build` (en PowerShell: `$env:ORBIT_HTTP_PORT = "18100"`). El servicio conserva el puerto interno `8100` y se abre en `http://localhost:18100`.

La carpeta `config/` queda montada como volumen, por lo que tus cambios de configuración y catálogo se conservan al recrear el contenedor. Para exportarlo a otra plataforma sólo necesitas copiar/clonar el repositorio y ejecutar el mismo comando, o publicar la imagen Docker resultante.

Comprueba que el servicio ha terminado de arrancar con `docker compose ps`: debe mostrar el estado `healthy`. Para ver registros usa `docker compose logs -f orbit`; para detenerlo, `docker compose down`.

## Scripts de operacion en Windows

Todos los accesos operativos están centralizados en `.scripts/`. Ejecútalos desde la raíz de Orbit con doble clic o desde PowerShell:

```powershell
.\.scripts\restart-orbit.cmd  # Build incremental, reinicio y healthcheck de Docker
.\.scripts\restart-orbit.cmd -SkipBuild # Solo reinicia la imagen ya creada
.\.scripts\restart-orbit.cmd -NoCache # Reconstruccion limpia, solo si hace falta
.\.scripts\orbit-status.cmd   # Muestra el estado y healthcheck
.\.scripts\orbit-logs.cmd     # Sigue los logs; se detiene con Ctrl+C
.\.scripts\test-ui.cmd        # Reinicia Orbit y ejecuta las pruebas de interfaz
.\.scripts\test-node.cmd      # Pruebas unitarias del gateway Node.js
.\.scripts\test-frontend.cmd  # Pruebas unitarias de front/ (sin Docker)
.\.scripts\test-react-build.cmd # Compilacion de React y runtime Cesium
.\.scripts\test-backend.cmd   # Pruebas de server/python/ dentro de Docker
.\.scripts\test-all.cmd       # Frontend + backend + integración completa
.\.scripts\audit-code.ps1     # Detecta código, imports y variables no usados
```

La estructura y responsabilidades de cada capa de pruebas están en
[la guía de pruebas](docs/wiki/development/testing.md).

Cada `push` y `pull request` ejecuta automáticamente **Orbit quality** en
GitHub Actions: pruebas Node, frontend y Python, build React, build estricto de
la documentación y auditoría estática. Los cambios documentales también pasan
por **Deploy documentation**; GitHub Pages sólo se publica tras un push a
`main`. Consulte la [guía de pruebas](docs/wiki/development/testing.md) para
los límites de estas validaciones y la política de releases con tags SemVer.

## Pruebas visuales de la interfaz

Con Orbit arrancado en Docker, genera capturas y valida el catÃ¡logo en cinco resoluciones de pantalla:

```bash
.\.scripts\test-ui.cmd
```

Las capturas y el informe HTML se guardan en `tests/artifacts/`. Puedes usar otra instancia o puerto con `ORBIT_UI_BASE_URL`, por ejemplo `ORBIT_UI_BASE_URL=http://localhost:8100 npm run test:ui`.

Las pruebas UI se ejecutan de forma serial. Aunque cada caso usa su propio navegador, comparten el estado persistente de proyecto y catálogo de Orbit; serializarlas evita que una prueba reemplace el estado que otra está comprobando.

## Ejecutar sin Docker

Requiere Node.js 24 y Python 3.10+. En Windows, instala Python marcando la opción de añadirlo al `PATH`. Después:

```bash
py -3 -m pip install -r server/requirements.txt
cd react-ui
npm.cmd ci
npm.cmd run build
cd ../server
npm.cmd ci
npm.cmd start
```

En macOS o Linux, sustituye `py -3` por `python3` y `npm.cmd` por `npm`.

Abre `http://localhost:8100`.

`npm.cmd start` solo sirve el frontend ya compilado. La compilacion de
`react-ui` descarga las versiones fijadas de Cesium y pako, las incorpora en
`front/dist` y no requiere CDN en ejecucion. Docker ejecuta esa compilacion
automaticamente; si se arranca Node directamente hay que ejecutar
`npm.cmd run build` en `react-ui` antes de `npm.cmd start`.

Orbit es un proyecto que ejecuta un servidor Node.js para servir una aplicación de visualización de satélites y comunicación con un backend Python.

## Propósito

El propósito de este repositorio es proporcionar una forma sencilla de iniciar y detener el servidor que ejecuta la aplicación, así como documentar cómo usar los scripts disponibles para administración del servicio.

## Cómo arrancar el servidor

1. Ir al directorio del servidor:
   ```bash
   cd server
   ```
2. Instalar dependencias si aún no están instaladas:
   ```bash
   npm install
   ```
3. Compilar el frontend local antes del primer arranque o tras actualizar Cesium/pako:
   ```bash
   cd ../react-ui
   npm.cmd ci
   npm.cmd run build
   cd ../server
   ```
4. Iniciar el servidor en primer plano:
   ```bash
   npm.cmd start
   ```

Detén el servidor con `Ctrl+C` en esa misma terminal. Para el uso habitual, utiliza Docker y los comandos de `.scripts/`; no se guardan archivos PID locales.

## Mejorar calidad al hacer zoom (tiles locales de earth2km)

Para evitar cargar una imagen gigante completa en memoria, Orbit soporta teselas locales (`XYZ`) para `earth2km`.

### 1) Generar teselas

Desde la carpeta `server`:

```bash
npm run tiles:earth2km
```

Esto crea:

`front/assets/earth2km_tiles/{z}/{x}/{y}.jpg`

### 2) Arrancar servidor

```bash
npm start
```

La app detecta automáticamente si existe `assets/earth2km_tiles/0/0/0.jpg`.

- Si existe: usa `earth3km` como base + superposición `earth2km_tiles` (más detalle en zoom).
- Si no existe: mantiene solo la base `earth3km`.

### Notas

- El script actual genera zooms `0..6` por defecto.
- Puedes aumentar `--max-zoom` en el comando si quieres más detalle (a costa de tamaño en disco y tiempo de generación).
