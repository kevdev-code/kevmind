# KevMind

Mira en vivo cómo trabaja Claude Code: qué hace, qué agentes lanza en paralelo, qué archivos toca y dónde falla. Todo corre en tu computadora; nada sale de ella.

![Demo del panel de KevMind](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/kevmind-demo.gif)

![Vista En vivo de KevMind con el tema claro](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/kevmind-light.png)

[English](README.md) · **Español**

> Estado: **0.6** (sin publicar). El panel en vivo, la pestaña Memoria con sus sugerencias de memoria, el mapa del proyecto, la pestaña Cerebro y Ver en tu teléfono funcionan. Qué cambió en cada versión: [CHANGELOG.md](CHANGELOG.md) (en inglés).

## Qué muestra

- **Sesiones** de las últimas 24 h, agrupadas por proyecto (el más reciente primero, el actual abierto), cada una con su título o su primer mensaje, hora de inicio y duración; las cerradas hace más de 2 h se pliegan en "Mostrar cerradas". Estado: trabajando, en espera, espera tu OK. Cuando una sesión espera tu OK, la pestaña del navegador lo dice aunque estés en otra: el título empieza con "⏸ Necesita tu OK" y el ícono lleva un punto ámbar. Sin sonidos ni notificaciones.
- **Agentes en paralelo**: línea de tiempo de Claude y cada subagente que lanza, con cuántas acciones hizo cada uno.
- **Actividad en vivo**: cada lectura, edición, comando, búsqueda y llamada MCP al instante.
- **Archivos más tocados**: cuántas veces se leyó y editó cada uno.
- **Herramientas**: usos, errores y tiempo promedio.
- **Alertas de conflicto**: cuando dos agentes editan el mismo archivo con menos de 5 minutos de diferencia, agrupadas por archivo y par de agentes; se ven las tres más recientes, con "ver todas".
- **Qué dice y qué piensa Claude**: extractos cortos de sus respuestas y de sus resúmenes de razonamiento legibles, leídos de la transcripción de la sesión, con un botón para ocultar los pensamientos. Si razonó pero no devolvió nada legible, el panel lo dice con la cantidad de tokens.
- **Tokens**: entrada, salida y caché (lectura/escritura) por sesión y por agente, contados una vez por llamada. Sin estimaciones de costo: los precios cambian.
- **Mapa del proyecto**: cada proyecto desde el primer día, sin historial de sesiones: sus áreas (carpetas), cuánta actividad tiene cada una y cuántos de sus commits fueron arreglos (git), qué hizo Claude ahí, y qué notas de memoria y secciones de `CLAUDE.md` hablan de ella. Se hace en segundo plano, solo lectura.
- **Pestaña Memoria**: lo que Claude Code y Serena recuerdan de cada proyecto. Cubre los `CLAUDE.md` y sus importaciones, la memoria automática de Claude y las notas de Serena, y muestra cuánto contexto se carga al inicio de cada sesión. Arriba, las [sugerencias de memoria](#sugerencias-de-memoria): cambios cortos a lo que Claude lee, cada uno con su evidencia y el texto exacto. Debajo, marca enlaces e importaciones rotos, notas que faltan en `MEMORY.md`, un `MEMORY.md` que pasa el límite de 200 líneas / 25 KB, archivos de instrucciones demasiado largos, copias en worktrees, notas grandes y posibles duplicados, cada uno con un botón "Copiar prompt de arreglo" para pegar en Claude Code. KevMind nunca edita esos archivos.
- **Pestaña Cerebro**: todo lo anterior como un cerebro 3D vivo. Las instrucciones, las notas de memoria, las notas de Serena, los archivos de código que Claude tocó y las herramientas que usó son células agrupadas en lóbulos, con un color por tipo de conocimiento (instrucciones, documentos, lógica, interfaz, memoria, herramientas y tests, infraestructura); sus relaciones reales son fibras (notas que se enlazan o citan código, archivos que se importan o cambian juntos). Mientras una sesión trabaja, Claude (coral) y sus subagentes (plateados, numerados) viajan de archivo en archivo por las conexiones que los unen, dejando un rastro, y lo que tocan brilla y se enfría. Cuando Claude trabaja en varios proyectos a la vez, "Todas las sesiones activas" las muestra todas en el mismo cerebro, cada etiqueta con su proyecto, y una sesión que espera tu OK va primero. Cada tipo de acción (lectura, edición, archivo nuevo, búsqueda, comando, web, subagente, espera de tu OK, error) tiene su propia animación breve, para saber de un vistazo qué hace Claude. Orbita, acerca, busca, filtra, haz clic en una célula para ver sus detalles, o activa el giro automático. Solo datos reales, solo lectura, y queda totalmente quieto cuando no pasa nada.

El panel está en inglés y español, con tema oscuro y claro (sigue al sistema, o elige uno con el interruptor arriba a la derecha), y funciona en el ancho de un teléfono. En pantallas anchas la página no se desplaza: cada columna (sesiones, centro, panel derecho) tiene su propio scroll y la actividad se desplaza dentro de su panel.

Es ligero: HTML y CSS normales con fuentes del sistema. Sin dependencias; solo Node 18 o superior. Solo dibuja lo que cambió, no trabaja mientras está en reposo y deja de dibujar cuando su pestaña está oculta. La pestaña Cerebro es el único lugar que usa la GPU (WebGL 2 escrito a mano, sin dependencias): su código se carga solo al abrirla, dibuja como máximo 30 cuadros por segundo mientras algo se mueve y ninguno en reposo, y tiene un interruptor para apagar las animaciones. El sistema de diseño está en [DESIGN.md](DESIGN.md).

## La pestaña Cerebro

![La pestaña Cerebro mientras una sesión trabaja: Claude y tres subagentes viajan por las conexiones entre archivos](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/brain-live.webp)

Claude (coral) y sus subagentes (plateados, numerados) trabajando, con datos de demostración. Cada célula es un archivo, una nota o una herramienta real y cada fibra una relación real; la anatomía está trazada a partir de láminas de dominio público.

https://github.com/user-attachments/assets/a6ae002e-35aa-4a21-8e9f-80fc2a9ad993

Una grabación de 33 segundos con los mismos datos de demostración: la intro, los agentes trabajando, el giro automático, las etiquetas y el corte. Si el reproductor no aparece (en npm, por ejemplo), el archivo está en el repositorio: [brain-demo.mp4](https://github.com/kevdev-code/kevmind/raw/main/docs/media/brain-demo.mp4) (descarga de 4 MB).

![Una animación breve por tipo de acción: lectura, edición, archivo nuevo, búsqueda, comando, web, subagente, necesita tu OK, error, terminó](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/brain-actions-es.webp)

Cada tipo de acción tiene su propia animación breve, construida solo con lo que dicen los eventos de los hooks. La leyenda está a un clic en la pestaña.

## Instalación

### Opción A: como plugin de Claude Code (recomendado)

KevMind es un plugin solo para Claude Code; no tiene nada que hacer en claude.ai ni en Cowork, que además rechazan plugins con una carpeta `bin/` en la raíz. KevMind conserva su `bin/`, así `kevmind` queda en el PATH de la herramienta Bash mientras el plugin está activo.

El repositorio es su propio marketplace de plugins. En una sesión de Claude Code, agrégalo una vez e instala el plugin desde ahí:

```text
/plugin marketplace add kevdev-code/kevmind
/plugin install kevmind@kevmind
```

El segundo comando abre los detalles del plugin, donde eliges el alcance y confirmas. En Claude Code 2.1.275 o superior, un solo comando hace los dos pasos: `/plugin install kevmind --marketplace kevdev-code/kevmind`. Desde una terminal en vez de una sesión:

```bash
claude plugin marketplace add kevdev-code/kevmind
claude plugin install kevmind@kevmind
```

El plugin registra los hooks solo. Después abre el panel:

```bash
npx kevmind
```

Para actualizar más adelante: `/plugin marketplace update kevmind` y luego `/plugin update kevmind@kevmind`.

### Opción B: hooks manuales

```bash
npx kevmind install    # agrega los hooks a ~/.claude/settings.json (con respaldo)
npx kevmind            # abre el panel en http://localhost:4777
```

Para quitarlos: `npx kevmind uninstall`.

Usa una opción, no las dos: con el plugin y los hooks manuales instalados a la vez, cada evento llegaría dos veces. `kevmind install` se niega si encuentra el plugin instalado (`--force` lo fuerza), y si instalaste los hooks a mano, corre `npx kevmind uninstall` antes de instalar el plugin. Como red de seguridad, el servidor descarta la repetición exacta de un evento que llega en menos de 3 segundos.

No necesitas mantenerlo abierto tú: cuando empieza una sesión de Claude Code y nada responde en el puerto, el hook arranca el panel en segundo plano, sin ventana, y termina enseguida. Pon `KEVMIND_AUTOSTART=0` para desactivarlo.

`npx kevmind start --background` lo abre separado de la terminal, así sigue corriendo cuando la cierras (salida en `~/.kevmind/server.log`). `npx kevmind stop` cierra el panel en ejecución; `npx kevmind restart` lo cierra si está corriendo y lo vuelve a abrir tal como estaba.

`npx kevmind clear` borra las sesiones de demo de los datos guardados; `npx kevmind clear --project <nombre>` borra el historial y el mapa de un proyecto (por nombre de carpeta o ruta); `npx kevmind clear --all` borra todo (pregunta antes; `--yes` omite la pregunta). Los eventos se guardan en un archivo por mes (`events-AAAA-MM.jsonl`, meses en UTC); el `events.jsonl` único de versiones anteriores se divide por meses la primera vez que arranca el panel.

### Probar sin Claude Code

```bash
npx kevmind demo
```

Simula una sesión con tres agentes en paralelo. Aparece como proyecto `demo-kevmind` para que no se confunda con datos reales.

## Grabar una demo

Dos parámetros en la URL dejan fuera de pantalla a los demás proyectos:

- `http://localhost:4777/?project=KevMind` muestra solo las sesiones de ese proyecto. El selector arriba de la lista de sesiones hace lo mismo y recuerda tu elección.
- `http://localhost:4777/?focus=latest` oculta la lista de sesiones y muestra solo la sesión iniciada más recientemente, cambiando a una más nueva en cuanto aparece.

Combínalos para grabar un solo proyecto: `http://localhost:4777/?project=KevMind&focus=latest`.

## Sugerencias de memoria

Claude lee `CLAUDE.md` y el índice de su memoria al inicio de cada sesión, y un `CLAUDE.md` anidado cuando trabaja en esa carpeta. Así que KevMind ayuda mejorando lo que Claude ya lee: la pestaña Memoria propone cambios cortos, cada uno con su evidencia y el texto exacto, y tú aplicas los que quieras. KevMind nunca los escribe.

- **Datos equivocados:** una ruta que ya no existe o que se movió, un nombre que el código ya no tiene (`git log -S` distingue los nombres que se quitaron de los planeados), un script de `npm run` que ningún `package.json` tiene. El cambio reemplaza o quita esa línea exacta; cuando la línea dice más que la referencia vieja, un prompt le pide a Claude que la actualice. Las notas a menudo cuentan historia a propósito: ahí, **Dejarla, es historia** descarta la sugerencia para siempre.
- **Un fallo que vuelve** con el mismo arreglo (el mismo comando y el mismo error en al menos 2 episodios de trabajo en 2 días, arreglado igual al menos dos veces): una línea que dice qué lo arregla.
- **Archivos que Claude lee en cada sesión sin editarlos** (en al menos la mitad de las sesiones con trabajo, al menos 5, en 3 días): una línea con lo que exporta el archivo y el archivo con el que suele cambiar. Una lectura antes de editar no cuenta; Claude Code la exige.
- **Áreas muy activas o propensas a fallos de las que no habla ninguna nota:** una línea con los commits, los arreglos y los archivos que más se arreglan.
- **Recortes:** la línea de `MEMORY.md` de una nota que ninguna sesión abre, una sección de `CLAUDE.md` que solo cita código que nadie tocó en 180 días, y una línea añadida que no cambió nada.

Cada línea añadida tiene menos de 160 caracteres (unos 40 tokens) y va al `CLAUDE.md` más cercano por encima del código que nombra; cuando ese archivo pasaría de 200 líneas, se convierte en una nota de memoria con una línea en `MEMORY.md`. Cada tarjeta muestra los tokens que añade o ahorra, el cambio como diff, **Copiar texto**, **Copiar prompt** (el mismo cambio redactado para Claude Code) y **Descartar**. Se muestran como máximo 5 por proyecto; el resto queda plegado.

**¿Ayuda?** Cuando el cambio de una sugerencia aparece en los archivos (aunque lo redactes distinto), KevMind mide lo que buscaba mejorar, antes y después, durante al menos 5 sesiones en 3 días: si el fallo deja de repetirse, si el archivo se lee sin editar en menos sesiones (al menos 20 puntos menos), si se leen menos archivos antes de la primera edición en esa área. Si una línea no cambió nada, se sugiere quitarla, porque cuesta tokens cada vez que se carga. Es una correlación, no una prueba, y el panel lo dice.

Las sugerencias que salen del código, de git y de tus notas funcionan desde el primer día; las que salen de las sesiones necesitan una semana de uso normal, más o menos. El trabajo se cuenta en episodios: un turno de prompt que termina con al menos una edición (sin prompts, un bloque de actividad separado del siguiente por más de 30 minutos). Las fechas y los días están en la zona horaria de tu máquina. Cada archivo pertenece al repo de git que lo contiene, así que un `frontend/` y un `backend/` con sus propios repos se cuentan por separado.

**¿Por qué no herramientas ni un resumen?** Las versiones anteriores también le daban a Claude cuatro herramientas MCP (`file_context`, `file_history`, `known_failures`, `code_map`) y un resumen de inicio de sesión. En benchmarks controlados Claude nunca llamó a las herramientas por su cuenta, ni siquiera con una pista de una línea, y el resumen no mostró un ahorro de tokens consistente; en dos días de uso real, las herramientas se llamaron 4 veces en 39 sesiones. Ambas se quitaron en la 0.6.0. [docs/BENCHMARK.md](docs/BENCHMARK.md) (en inglés) cuenta cómo se midieron.

## Mapa del proyecto

KevMind no debería necesitar semanas de sesiones para conocer un proyecto. La primera vez que un proyecto tiene una sesión de Claude Code, el panel hace su mapa en segundo plano (alrededor de un segundo para mil archivos); `npx kevmind init [ruta]` o el botón **Rehacer** de la pestaña Memoria lo hacen en el momento.

- **Las áreas son carpetas.** Una carpeta con más de 40 archivos de código se divide en sus subcarpetas. Para cada área: sus archivos centrales y qué áreas usa (de los imports), commits de los últimos 90 días y de los últimos 12 meses, cuántos se marcaron como arreglo, reverts, cuándo cambió por última vez (git), qué leyó y editó Claude ahí y qué fallos conocidos se arreglaron ahí (el registro de KevMind), y las notas que hablan de ella.
- **Tu memoria, ordenada.** Las notas de la memoria automática, las de Serena y cada sección de `CLAUDE.md` se enlazan con las áreas que citan o nombran. KevMind nunca escribe ni edita una nota. Las áreas con mucha actividad de las que no habla ninguna nota se vuelven [sugerencias de memoria](#sugerencias-de-memoria); las áreas que citan muchas notas se señalan con un prompt para copiar.
- **Cada dato dice de dónde viene**: código, git, sesiones de Claude o notas. Las sugerencias de memoria se construyen sobre él.
- **Ventana de historia:** 12 meses por defecto; `npx kevmind init --all` (o `--months=N`) lee más.
- El mapa vive en `~/.kevmind/tree/` (25 KB para un proyecto de 70 archivos, alrededor de 0,5 MB para uno de 950 archivos y 1.000 commits). No se escribe nada en el proyecto.

## Ver en el teléfono

Mira el panel desde tu teléfono en la misma red Wi-Fi. Haz clic en **Ver en el teléfono** en la pestaña En vivo (o ejecuta `npx kevmind share`) y escanea el código QR.

<img src="https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/brain-phone.webp" alt="La pestaña Cerebro en el ancho de un teléfono, con datos de demostración" width="300">

- **Apagado por defecto.** Hasta que lo enciendas, el panel solo escucha en `127.0.0.1`. Mientras está encendido, la cabecera muestra **Compartido en tu red** con un botón para detenerlo.
- **Solo tu red doméstica.** Escucha en tu dirección de Wi-Fi o Ethernet, nunca en adaptadores de VPN, WSL, Docker o Hyper-V, y nada pasa por internet (sin túneles).
- **Un enlace privado.** Cada vez que lo enciendes, KevMind crea un token aleatorio. El enlace lo lleva, tu teléfono lo guarda en una cookie y todo lo que llegue sin él recibe un 401. **Enlace nuevo** (o `npx kevmind share new`) hace que el enlace y el código QR anteriores dejen de funcionar al instante.
- **Solo lectura.** El teléfono puede verlo todo, pero no cambiar ajustes ni el uso compartido.
- **¿El teléfono no se conecta?** En Windows, permite Node.js solo en redes **privadas** (nunca públicas) y revisa que tu Wi-Fi esté como privada. El panel y `npx kevmind share` muestran el comando exacto del firewall.

`npx kevmind share off` lo detiene; `npx kevmind share status` vuelve a mostrar el enlace.

## Privacidad

- Todo se queda en `~/.kevmind/`. No hay telemetría.
- Antes de guardar, se ocultan claves API, tokens de GitHub/AWS/Slack, JWT, llaves privadas y variables tipo `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`.
- El servidor solo escucha en `127.0.0.1`, salvo que enciendas [Ver en tu teléfono](#ver-en-tu-teléfono): entonces también escucha en tu red doméstica, en solo lectura y con un enlace privado.
- Si el panel está apagado, el hook enmascara los eventos antes de guardarlos en `spool.jsonl`.
- La pestaña Memoria solo lee. Muestra metadatos, descripciones y encabezados, nunca el cuerpo completo de las notas. De la configuración global de Serena solo lee la lista de proyectos, nunca el `auth_secret`. Git se usa solo con `git ls-tree`, `git ls-files`, `git log` y `git log -S`, de solo lectura (este último para distinguir los nombres de código que se quitaron de los que nunca existieron).
- De las transcripciones solo se guardan extractos de hasta 200 caracteres, enmascarados como todo lo demás. Las firmas del razonamiento nunca se leen y la transcripción nunca se copia.
- Las sugerencias de memoria se construyen con lo que KevMind ya tiene: el registro de eventos enmascarado, el mapa del proyecto y el informe de Memoria. KevMind guarda su propio registro de ellas en `~/.kevmind/suggestions.json` (cuáles se mostraron, descartaron y aplicaron, y su evidencia: cuentas y rutas, nunca el contenido de los archivos) y nunca escribe un archivo del proyecto, un `CLAUDE.md` ni una nota. A Claude no le llega nada salvo lo que tú pegues.
- El mapa del proyecto guarda rutas, nombres exportados, cuentas, hashes de commits y el asunto de los commits de revert (80 caracteres como máximo); nunca el contenido de los archivos.
- `npx kevmind clear --project <nombre>` borra el historial y el mapa de un proyecto.

Para cómo funciona, configuración, limitaciones y hoja de ruta, ver el [README en inglés](README.md).

## Licencia

MIT
