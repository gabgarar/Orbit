# Administración local de usuarios

[Inicio](../index.md) · [Guía de usuario](index.md) · [Identidad y proyectos](identity-projects.md)

La administración de usuarios de Orbit es **por instalación**. Controla las
cuentas y los proyectos que existen en este navegador o contenedor local; no
crea un directorio global de Orbit, no contacta un servidor de usuarios y no
concede acceso a cuentas de Google o Microsoft fuera del dispositivo.

!!! warning "No es una consola de administración remota"

    No hay cuenta maestra de Orbit, credencial de soporte, contraseña por
    defecto ni mecanismo de recuperación por correo. El restablecimiento
    administrativo descrito más abajo existe solamente en la misma instalación
    y para cuentas que ya hayan inscrito su clave local de recuperación. Borrar
    los datos del navegador, mover el proyecto a otro dispositivo o perder toda
    la administración local no puede resolverse desde un backend.

## Alcance y principio de mínimo conocimiento

Una instalación puede conservar metadatos administrativos locales para sus
propias cuentas. Esos metadatos no forman parte del selector de correo ni de la
respuesta de comprobación inicial. Antes de desbloquear la bóveda, la interfaz
solo puede recibir uno de estos resultados:

| Resultado | Significado permitido | Lo que no revela |
| --- | --- | --- |
| `exists: true` | Hay un selector local coincidente. | Rol, nombre, proyectos, estado de bloqueo o proveedor vinculado. |
| `exists: false` | No hay selector local coincidente en esta instalación. | Si esa identidad existe en otro dispositivo o proveedor. |
| `exists: null` | La instalación no puede comprobar el selector de forma segura. | Si la cuenta existe, está bloqueada o tiene privilegios. |

El estado de bloqueo y cualquier rol se consultan únicamente después de una
verificación criptográfica de la contraseña. Una cuenta bloqueada devuelve el
error específico `ACCOUNT_LOCKED` a quien llega a ese punto de autenticación;
la búsqueda previa sigue sin revelar bloqueo, rol, perfil ni proyectos, por lo
que no se usa como oráculo para enumerar la política de la instalación.

## Bootstrap seguro de administración

En una instalación nueva no existe ninguna contraseña administrativa
preconfigurada. El bootstrap usa el identificador local reservado
`admin@orbit.com`, pero solo como ruta inicial de administración: no es una
credencial ni puede abrir la aplicación por sí mismo. El alta debe ser una
acción local y explícita:

1. La persona elige la primera contraseña de `admin@orbit.com`; Orbit no acepta
   una contraseña proporcionada por código, variable de entorno o plantilla.
2. La operación comprueba, bajo el mismo bloqueo de escritura de la bóveda,
   que todavía no se haya inicializado la administración local.
3. Solo entonces se registra el rol inicial de administración dentro del
   almacenamiento cifrado de esa instalación. Dos pestañas no pueden obtener
   el rol inicial a la vez: Web Locks coordina navegadores modernos y el
   proceso mantiene una cola local de reserva.
4. La sesión se mantiene solo en memoria. Reiniciar Orbit exige volver a
   desbloquear una cuenta; no hay inicio de sesión administrativo silencioso.

El bootstrap no se activa por escribir otro correo conocido, por una identidad
OAuth vinculada ni por importar un archivo de proyecto. La comprobación previa
del selector tampoco revela que `admin@orbit.com` tenga un rol especial. Google
y Microsoft pueden identificar a una persona en el proveedor, pero no
sustituyen el protector local ni otorgan administración de la instalación.

## Roles locales y bloqueo

Los roles tienen alcance exclusivamente local. Una persona administradora puede
gestionar cuentas de esta instalación según la política habilitada, pero no
puede inspeccionar contraseñas, claves, tokens, archivos de otro navegador ni
cuentas de un proveedor externo.

Al bloquear una cuenta, Orbit debe:

- invalidar su sesión y sus capacidades de bóveda en memoria;
- impedir nuevos accesos y operaciones de proyecto de esa cuenta en la
  instalación;
- conservar la bóveda y los proyectos cifrados sin eliminarlos;
- rechazar el bloqueo del último administrador activo, salvo que antes se haya
  transferido la administración a otra cuenta local.

El bloqueo no borra datos, no revoca una sesión de Google o Microsoft en el
proveedor y no puede cerrar una sesión que permanezca abierta en otro
dispositivo. Para retirar definitivamente información local se usa una acción
de eliminación separada, visible y confirmada.

## Panel de administración

Al iniciar sesión con una cuenta cuyo rol local sea `admin`, Orbit abre un
espacio de gestión aislado: no monta el visor, no abre la biblioteca de
proyectos y no ofrece controles de órbitas. El directorio permite:

- buscar por nombre mostrado o correo/identidad;
- consultar proveedor local, Google o Microsoft, último inicio de sesión,
  estado de bloqueo, solicitudes pendientes y los intentos fallidos actuales
  y previos al último acceso correcto;
- bloquear o desbloquear, añadir una nota privada de operador y eliminar una
  cuenta con confirmación;
- marcar que una persona debe cambiar su contraseña en su próximo acceso;
- establecer una contraseña local nueva para otra cuenta compatible sin ver,
  copiar ni exportar su contraseña actual;
- ajustar el número de intentos locales fallidos antes de bloquear una cuenta.

Las notas, el rol, el contador de intentos y la solicitud no se guardan en el
índice público de cuentas: forman parte del directorio administrativo cifrado
de esta instalación.

`Intentos actuales` es la racha de fallos locales desde el último acceso
correcto. `Fallos antes del último éxito` conserva esa racha justo antes de que
el último acceso correcto la reiniciase. Un restablecimiento directo limpia la
racha actual y desbloquea la cuenta; no borra el dato histórico del último
acceso correcto.

!!! note "Cuentas anteriores"

    Una cuenta local creada antes de habilitar esta administración se incorpora
    al directorio y enrola su clave de recuperación local después de su
    siguiente inicio de sesión correcto. Hasta entonces, un restablecimiento
    directo falla cerrado sin cambiar datos; use el cambio obligatorio en el
    siguiente acceso válido. Orbit no descifra bóvedas ajenas para reconstruir
    una lista de correos, nombres o proyectos.

## Solicitud y restablecimiento de contraseña

Orbit no conoce ni reconstruye una contraseña local. Hay dos rutas locales,
separadas y sin correo ni backend:

1. **Solicitud identificada.** Al pulsar «¿Has olvidado tu contraseña?», Orbit
   pide explícitamente el correo o identificador. Si coincide con una cuenta
   local, registra una solicitud mínima para el panel administrativo. La misma
   respuesta genérica se devuelve para una cuenta ausente, malformada o
   existente, de modo que la acción no enumera usuarios. La persona
   administradora puede marcar la solicitud como atendida o forzar un cambio
   en el próximo inicio válido.
2. **Restablecimiento directo.** Una persona administradora autenticada puede
   fijar una contraseña nueva para otra cuenta local que tenga recuperación
   inscrita. No puede usar esta ruta para cambiar su propia contraseña. Orbit
   limpia la solicitud pendiente, el bloqueo y la racha actual de fallos, y la
   persona titular debe usar la contraseña nueva al volver a iniciar sesión.

Para preservar los datos, la instalación mantiene para cada cuenta inscrita una
`CryptoKey` AES no exportable en IndexedDB; el directorio cifrado conserva solo
una referencia opaca que no se publica al panel ni se exporta. Durante el
restablecimiento, Orbit usa esa clave internamente para volver a cifrar la
bóveda de la cuenta, los proyectos de todas sus particiones —incluidas las
identidades Google/Microsoft activas o desvinculadas que conservan proyectos—
y los envoltorios de tokens del
proveedor. La interfaz no recibe la contraseña previa, la clave ni el contenido
de los proyectos, y ninguna API administrativa los devuelve.

Desvincular un proveedor retira su token y su enlace activo, pero no borra sus
proyectos locales automáticamente. Orbit conserva de forma privada y cifrada
el identificador opaco de esa partición para volver a cifrarla en un cambio de
contraseña posterior; si se vincula de nuevo la misma identidad, sus proyectos
continúan disponibles. Para eliminar esos datos hay que borrar los proyectos de
forma explícita o zeroizar la instalación.

Los cambios se preparan con reversión de los sobres cifrados si no se puede
confirmar la operación. Antes de reemplazar proyectos se guarda un diario local
cifrado. Si el navegador se interrumpe antes de escribir la bóveda nueva, el
siguiente inicio o restablecimiento administrativo recupera los sobres
anteriores; si ya se escribió la bóveda candidata pero no el cierre del
directorio, termina ese cierre. Si la reversión de algún proyecto no puede
demostrarse completa, Orbit conserva el diario y la clave candidata en vez de
declarar seguro un estado mixto: el siguiente acceso autenticado decide de
forma criptográfica entre bóveda antigua y candidata y restaura o finaliza la
migración antes de exponer los proyectos.

Al confirmar, la generación de credenciales invalida las sesiones y capacidades
de bóveda ya emitidas para la cuenta objetivo. Una sesión anterior no puede
seguir actualizando el perfil, abrir proyectos, reentrar en Google/Microsoft ni
leer, guardar o retirar sus sobres de token: su siguiente operación protegida
devuelve `ACCOUNT_PASSWORD_RESET`. De manera equivalente, una marca de cambio
obligatorio devuelve `PASSWORD_CHANGE_REQUIRED` para cualquier operación del
espacio de trabajo hasta completar `changeLocalPassword`; no se permite usar esa
sesión para modificar datos mientras tanto. Orbit no cambia la contraseña de
Google o Microsoft, no recupera nada de otro dispositivo y no envía correo.

!!! warning "Autoridad local de recuperación"

    La clave no exportable evita que la contraseña o la clave se copie desde
    Orbit, pero una persona administradora de la misma instalación tiene la
    autoridad local para recuperar y volver a cifrar cuentas inscritas. No es
    confidencialidad de extremo a extremo exclusiva de la contraseña frente a
    código privilegiado del mismo origen o al perfil local del navegador.
    Zeroize elimina también estas claves de recuperación. Si no queda ningún
    administrador local capaz de operar, Orbit no puede saltar esa condición.

## Límites operativos

- Los datos administrativos, cuentas y proyectos viven en el dispositivo y en
  el origen local de Orbit. No se sincronizan entre instalaciones.
- El cifrado protege almacenamiento persistido frente a una copia pasiva, pero
  no frente a código malicioso que ejecute en el mismo origen mientras una
  sesión está abierta. La recuperación administrativa local amplía esa
  autoridad al administrador de la instalación para cuentas inscritas. Para
  elevar esa garantía se necesita un contenedor de escritorio y un almacén de
  credenciales del sistema operativo.
- No hay auditoría central, telemetría de usuarios ni notificaciones por correo.
  Cualquier historial operativo disponible es local y queda sujeto a la misma
  política de cifrado y borrado de la instalación.
- Una exportación `.orbit.json` o `.ics` es una entrega explícita y legible;
  no transporta sesiones, roles, contraseñas ni tokens de proveedor.
- Las funciones de planificación, propagación y BIT siguen requiriendo una
  cuenta desbloqueada y el estado científico válido. Un rol local no omite esas
  validaciones.

## Contratos que se validan

Las pruebas de identidad y administración deben verificar como mínimo:

- no existe una credencial administrativa por defecto y una nueva instancia no
  restaura sesiones;
- el bootstrap concurrente no crea dos administradores iniciales;
- la búsqueda previa no revela roles, bloqueo, perfiles ni proyectos;
- bloquear invalida la sesión/capacidad pero no elimina el proyecto cifrado y
  el acceso posterior devuelve `ACCOUNT_LOCKED` después de verificar la
  contraseña;
- una solicitud de restablecimiento no contiene contraseñas ni cambia
  credenciales por sí sola y no sirve para enumerar identidades;
- el restablecimiento directo rechaza la contraseña previa, acepta la nueva,
  migra bóveda, proyectos locales/vinculados y sobres de proveedor, y revierte
  sus cambios si falla;
- una cuenta anterior sin clave de recuperación falla cerrado hasta un inicio
  de sesión correcto; referencias de recuperación y generaciones de
  credenciales no llegan a la interfaz ni a exportaciones;
- sesiones existentes y una pestaña concurrente no pueden sobrescribir una
  rotación confirmada ni acceder a proyectos, identidades vinculadas o tokens;
  ambas rachas de intentos conservan su semántica;
- una interrupción antes o después de persistir la bóveda candidata restaura
  los proyectos anteriores o termina la rotación de forma determinista. Una
  reversión de proyecto incierta mantiene el diario hasta esa recuperación, sin
  exponerlo ni exponer claves a la interfaz; y
- ninguna ruta administrativa realiza `fetch`, registra telemetría o envía
  correos, tokens o eventos a un backend de Orbit.
