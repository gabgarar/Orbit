# Orbit

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
3. Iniciar el servidor en segundo plano:
   ```bash
   npm run start:daemon
   ```

Esto ejecuta `node nodeServer.js`, guarda la salida en `server.log` y deja el PID en `server.pid`.

## Cómo detener el servidor

1. Ir al directorio del servidor:
   ```bash
   cd server
   ```
2. Detener el servidor usando el PID almacenado:
   ```bash
   npm run stop
   ```

Si el proceso ya no está en ejecución, el script eliminará el archivo `server.pid` obsoleto y te informará.

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
