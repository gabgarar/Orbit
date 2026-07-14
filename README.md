# Orbit

Architecture and module conventions are documented in [docs/architecture.md](docs/architecture.md).

## Ejecutar en local (recomendado: Docker)

El proyecto incluye un entorno reproducible para Windows, macOS, Linux y despliegues en la nube. Instala [Docker Desktop](https://www.docker.com/products/docker-desktop/) y, desde la raíz del repositorio, ejecuta:

```bash
docker compose up --build
```

Abre `http://localhost:8100`. Para detenerlo, usa `Ctrl+C`; para dejarlo en segundo plano:

```bash
docker compose up -d --build
```

La carpeta `config/` queda montada como volumen, por lo que tus cambios de configuración y catálogo se conservan al recrear el contenedor. Para exportarlo a otra plataforma sólo necesitas copiar/clonar el repositorio y ejecutar el mismo comando, o publicar la imagen Docker resultante.

Comprueba que el servicio ha terminado de arrancar con `docker compose ps`: debe mostrar el estado `healthy`. Para ver registros usa `docker compose logs -f orbit`; para detenerlo, `docker compose down`.

## Scripts de operacion en Windows

Todos los accesos operativos están centralizados en `.scripts/`. Ejecútalos desde la raíz de Orbit con doble clic o desde PowerShell:

```powershell
.\.scripts\restart-orbit.cmd  # Reconstruye y reinicia Docker
.\.scripts\orbit-status.cmd   # Muestra el estado y healthcheck
.\.scripts\orbit-logs.cmd     # Sigue los logs; se detiene con Ctrl+C
.\.scripts\test-ui.cmd        # Reinicia Orbit y ejecuta las pruebas de interfaz
.\.scripts\test-frontend.cmd  # Pruebas unitarias de public/ (sin Docker)
.\.scripts\test-backend.cmd   # Pruebas de server/python/ dentro de Docker
.\.scripts\test-all.cmd       # Frontend + backend + integración completa
```

La estructura y responsabilidades de cada capa de pruebas están en
[docs/TESTING.md](docs/TESTING.md).

## Pruebas visuales de la interfaz

Con Orbit arrancado en Docker, genera capturas y valida el catÃ¡logo en cinco resoluciones de pantalla:

```bash
.\.scripts\test-ui.cmd
```

Las capturas y el informe HTML se guardan en `server/ui-artifacts/`. Puedes usar otra instancia o puerto con `ORBIT_UI_BASE_URL`, por ejemplo `ORBIT_UI_BASE_URL=http://localhost:8100 npm run test:ui`.

Las pruebas se ejecutan con dos workers en paralelo. En un equipo potente puedes aumentar el número temporalmente, por ejemplo: `.\.scripts\test-ui.cmd -Workers 3`.

## Ejecutar sin Docker

Requiere Node.js 20+ y Python 3.10+. En Windows, instala Python marcando la opción de añadirlo al `PATH`. Después:

```bash
py -3 -m pip install -r requirements.txt
cd server
npm.cmd ci
npm.cmd start
```

En macOS o Linux, sustituye `py -3` por `python3` y `npm.cmd` por `npm`.

Abre `http://localhost:8100`.

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
3. Iniciar el servidor en primer plano:
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

`public/assets/earth2km_tiles/{z}/{x}/{y}.jpg`

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
