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
