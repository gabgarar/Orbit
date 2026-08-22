# Administración local de usuarios

[Inicio](../index.md) · [Guía de usuario](index.md) · [Identidad y proyectos](identity-projects.md)

La administración de usuarios de Orbit es **por instalación**. Controla las
cuentas y los proyectos que existen en este navegador o contenedor local; no
crea un directorio global de Orbit, no contacta un servidor de usuarios y no
concede acceso a cuentas de Google o Microsoft fuera del dispositivo.

!!! warning "No es una consola de administración remota"

    No hay cuenta maestra de Orbit, credencial de soporte, contraseña por
    defecto ni mecanismo de recuperación por correo. Borrar los datos del
    navegador, perder la contraseña de todas las personas administradoras o
    mover el proyecto a otro dispositivo no puede resolverse desde un backend:
    la recuperación depende de una copia o exportación que la persona haya
    conservado explícitamente.

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
  estado de bloqueo y solicitudes pendientes;
- bloquear o desbloquear, añadir una nota privada de operador y eliminar una
  cuenta con confirmación;
- marcar que una persona debe cambiar su contraseña en su próximo acceso;
- ajustar el número de intentos locales fallidos antes de bloquear una cuenta.

Las notas, el rol, el contador de intentos y la solicitud no se guardan en el
índice público de cuentas: forman parte del directorio administrativo cifrado
de esta instalación.

!!! note "Cuentas anteriores"

    Una cuenta local creada antes de habilitar esta administración se incorpora
    al directorio después de su siguiente inicio de sesión correcto. Orbit no
    descifra bóvedas ajenas para reconstruir una lista de correos, nombres o
    proyectos; esa limitación preserva la confidencialidad del almacenamiento
    previo.

## Restablecimiento solicitado

Orbit no conoce ni puede reconstruir una contraseña local. Por ello un
restablecimiento es una **solicitud local pendiente**, no un enlace de correo ni
una sustitución administrativa de contraseña.

1. La persona solicita el restablecimiento desde la misma instalación.
2. Orbit registra una solicitud mínima y local hasta que una persona
   administradora la marque como atendida. No guarda una contraseña nueva ni
   datos de autenticación en texto claro.
3. Una persona administradora autenticada puede marcarla atendida o activar
   el cambio de contraseña obligatorio en esa instalación. Esta última acción
   solo marca el cambio para el siguiente acceso correcto; no puede descifrar
   la bóveda ajena ni elegir una contraseña por la persona titular.
4. Al siguiente inicio de sesión con la contraseña actual, Orbit solicita una
   contraseña nueva y vuelve a cifrar la bóveda con ella. Marcar la solicitud
   como atendida sin forzar el cambio no modifica la bóveda ni los proyectos.

Una cuenta que no conoce su contraseña no puede recuperar criptográficamente
la bóveda mediante un administrador. La solicitud sirve para forzar el cambio
de una contraseña que la persona aún puede demostrar; no reemplaza ese flujo.
Si no queda ningún administrador local capaz de aprobarla, Orbit no puede
saltar esa condición.

## Límites operativos

- Los datos administrativos, cuentas y proyectos viven en el dispositivo y en
  el origen local de Orbit. No se sincronizan entre instalaciones.
- El cifrado protege almacenamiento persistido frente a una copia pasiva, pero
  no frente a código malicioso que ejecute en el mismo origen mientras una
  sesión está abierta. Para elevar esa garantía se necesita un contenedor de
  escritorio y un almacén de credenciales del sistema operativo.
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
  credenciales por sí sola;
- atender una solicitud solo puede forzar el cambio tras un inicio de sesión válido;
  no permite a un administrador descifrar ni recontraseñar otra bóveda;
- ninguna ruta administrativa realiza `fetch`, registra telemetría o envía
  correos, tokens o eventos a un backend de Orbit.
