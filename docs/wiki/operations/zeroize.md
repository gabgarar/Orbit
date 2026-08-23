# Restablecimiento operativo completo

[Inicio](../index.md) · [Operación](index.md) · [Configuración](configuration.md)

Orbit incluye un restablecimiento local controlado para preparar una instalación
como si fuera la primera ejecución, sin borrar código ni dependencias. Está
pensado para pruebas, demostraciones o para empezar de nuevo con una instancia
local.

## Ejecutarlo

Desde la raíz del repositorio, ejecute:

~~~powershell
.\.scripts\zeroize-orbit.cmd
~~~

El script muestra el alcance y pide una única confirmación de PowerShell antes
de modificar nada. Para revisar sin escribir ni borrar, use:

~~~powershell
.\.scripts\zeroize-orbit.cmd -WhatIf
~~~

Por defecto deja Orbit detenido para que el siguiente arranque muestre la
preparación, descarga y validación desde cero. Para arrancarlo inmediatamente
después:

~~~powershell
.\.scripts\zeroize-orbit.cmd -Restart
~~~

`-IncludeDevelopmentArtifacts` añade cachés de pruebas y artefactos de build;
no elimina `node_modules` ni los entornos virtuales.

## Qué se reinicia

El script detiene primero el servicio Compose si está activo y luego elimina:

- Las cachés IERS C01 y `finals2000A.all` de `data/erp/`.
- La caché NGA de EGM96/EGM2008, incluidos ZIP y coeficientes extraídos.
- Los productos GNSS precisos importados (SP3, CLK, ERP, ATT, OSB y
  manifiestos) y los ERP manuales adjuntos a órbitas.
- Los logs de ejecución y, opcionalmente, artefactos de desarrollo.
- Las preferencias, cuentas locales, claves no exportables y proyectos
  cifrados almacenados por Orbit en el navegador.

La última parte no intenta borrar perfiles de Chrome/Edge. El script escribe
una generación nueva dentro de `data/`; cuando Orbit vuelve a abrirse, el
cliente verifica esa generación **antes** de inicializar la identidad y borra
únicamente el almacenamiento con espacio de nombres de Orbit. Por tanto,
también se elimina la cuenta `admin@orbit.com` y deberá crearse de nuevo.

Si otra pestaña de Orbit mantiene IndexedDB abierto, el arranque muestra un
aviso y no carga la identidad antigua. Cierre las demás pestañas de Orbit y
recargue para terminar el restablecimiento.

## Recursos preservados

Dos ficheros se restauran a la semilla versionada de `HEAD`, en vez de dejarse
vacíos:

- `config/catalog.json`
- `config/system_config.json`

Así la imagen Docker sigue teniendo un catálogo y una configuración válidos.
Se descartan los cambios locales de esos dos ficheros, incluidos TLE importados
o preferencias guardadas en ellos. Los productos y cachés operativos sí se
eliminan, aunque Git pueda mostrarlos como borrados tras el reset.

También se conserva `config/eop/leap-seconds.list`. Es un snapshot IERS con
SHA-256 fijado, requerido para transformaciones precisas y no descargable de
forma automática; borrarlo podría impedir el arranque seguro.

Las fuentes externas declaradas mediante variables `ORBIT_*_PATH` no se siguen
ni se borran. Si ha configurado una ruta de este tipo, el script lo avisará.

## Después del reset

Arranque Orbit normalmente:

~~~powershell
.\.scripts\restart-orbit.cmd
~~~

El monitor volverá a descargar y validar las cachés automáticas IERS y NGA. Los
SP3 y ERP manuales son importaciones reproducibles locales: no se descargan
automáticamente y deben importarse otra vez cuando se necesiten.
