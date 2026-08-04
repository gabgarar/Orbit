# Instalación

[Inicio](../index.md) · [Requisitos](requirements.md) · [Inicio rápido](quick-start.md)

## Instalación con Docker Compose

Desde la raíz del repositorio, con Docker en ejecución:

~~~powershell
docker compose up --build
~~~

El comando construye la imagen, ejecuta las pruebas incluidas en la fase de
build, inicia el gateway y deja disponible Orbit en
http://localhost:8100. Para conservar el terminal:

~~~powershell
docker compose up -d --build
docker compose ps
~~~

El estado esperado es healthy. Los registros del conjunto de procesos se
consultan con:

~~~powershell
docker compose logs -f orbit
~~~

Para detenerlo:

~~~powershell
docker compose down
~~~

docker compose down detiene y elimina los contenedores, pero no elimina la
carpeta local config/ que Compose monta como volumen.

## Puerto e interfaz de escucha

El puerto interno del contenedor es siempre 8100. Los valores de host se
pueden ajustar sin modificar el archivo Compose.

~~~powershell
$env:ORBIT_HTTP_PORT = "18100"
$env:ORBIT_HTTP_BIND = "127.0.0.1"
docker compose up -d --build
~~~

Abra entonces http://localhost:18100. Establecer ORBIT_HTTP_BIND=0.0.0.0
publica el gateway en todas las interfaces de red. Esa opción no añade
autenticación y debe combinarse con controles de red externos.

## Scripts operativos de Windows

La carpeta .scripts/ contiene accesos consistentes para el entorno Docker.

| Comando | Efecto |
| --- | --- |
| ./.scripts/restart-orbit.cmd | Reconstruye incrementalmente, recrea el servicio y espera el healthcheck. |
| ./.scripts/restart-orbit.cmd -SkipBuild | Reutiliza la imagen actual y reinicia el servicio. |
| ./.scripts/restart-orbit.cmd -NoCache | Fuerza una reconstrucción sin caché. |
| ./.scripts/orbit-status.cmd | Muestra el estado de Compose. |
| ./.scripts/orbit-logs.cmd | Sigue los registros del servicio. |

!!! warning "Efecto de restart-orbit"

    Un reinicio con build ejecuta la fase de construcción completa de la
    imagen. Esa fase instala dependencias, ejecuta las suites de pruebas y
    compila el frontend; por ello puede producir muchos mensajes de salida y
    tardar más que un simple reinicio. Use -SkipBuild únicamente cuando la
    imagen ya contiene el código que desea ejecutar.

## Verificación de instalación

1. Abra la URL local publicada.
2. Compruebe que aparece la pantalla de bienvenida del proyecto o el espacio
   de trabajo.
3. Ejecute ./.scripts/orbit-status.cmd y confirme el estado saludable.
4. Si el visor no aparece, inspeccione primero los registros y después la
   disponibilidad de WebGL indicada en [Requisitos](requirements.md).

## Configuración de precisión opcional

La instalación no descarga EOP ni tablas UTC–TAI durante la ejecución. Para
montar esos datos de forma reproducible, coloque los snapshots bajo
config/eop/, defina sus rutas internas y reinicie el servicio. Consulte
[Operación de tiempo y EOP](../operations/time-eop.md) antes de activar el
modo estricto.

Continúe con el [inicio rápido](quick-start.md).

