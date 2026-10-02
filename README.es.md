# KevMind

Mira en vivo cómo trabaja Claude Code: qué hace, qué agentes lanza en paralelo, qué archivos toca y dónde falla. Todo corre en tu computadora; nada sale de ella.

![Demo del panel de KevMind](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/kevmind-demo.gif)

![Vista En vivo de KevMind con el tema claro](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/kevmind-light.png)

[English](README.md) · **Español**

> Estado: **0.5**. El panel en vivo, la pestaña Memoria, la pestaña Cerebro, Ver en tu teléfono y las herramientas de experiencia opcionales para Claude funcionan. Qué cambió en cada versión: [CHANGELOG.md](CHANGELOG.md) (en inglés).

## Qué muestra

- **Sesiones** de las últimas 24 h, agrupadas por proyecto (el más reciente primero, el actual abierto), cada una con su título o su primer mensaje, hora de inicio y duración; las cerradas hace más de 2 h se pliegan en "Mostrar cerradas". Estado: trabajando, en espera, espera tu OK. Cuando una sesión espera tu OK, la pestaña del navegador lo dice aunque estés en otra: el título empieza con "⏸ Necesita tu OK" y el ícono lleva un punto ámbar. Sin sonidos ni notificaciones.
- **Agentes en paralelo**: línea de tiempo de Claude y cada subagente que lanza, con cuántas acciones hizo cada uno.
- **Actividad en vivo**: cada lectura, edición, comando, búsqueda y llamada MCP al instante.
- **Archivos más tocados**: cuántas veces se leyó y editó cada uno.
- **Herramientas**: usos, errores y tiempo promedio.
- **Alertas de conflicto**: cuando dos agentes editan el mismo archivo con menos de 5 minutos de diferencia, agrupadas por archivo y par de agentes; se ven las tres más recientes, con "ver todas".
- **Qué dice y qué piensa Claude**: extractos cortos de sus respuestas y de sus resúmenes de razonamiento legibles, leídos de la transcripción de la sesión, con un botón para ocultar los pensamientos. Si razonó pero no devolvió nada legible, el panel lo dice con la cantidad de tokens.
- **Tokens**: entrada, salida y caché (lectura/escritura) por sesión y por agente, contados una vez por llamada. Sin estimaciones de costo: los precios cambian.
- **Pestaña Memoria**: lo que Claude Code y Serena recuerdan de cada proyecto, con los problemas primero. Cubre los `CLAUDE.md` y sus importaciones, la memoria automática de Claude y las notas de Serena. Muestra cuánto contexto se carga al inicio de cada sesión, y marca enlaces e importaciones rotos, notas que faltan en `MEMORY.md`, un `MEMORY.md` que pasa el límite de 200 líneas / 25 KB, archivos de instrucciones demasiado largos, rutas desactualizadas, copias en worktrees, notas grandes, posibles duplicados y notas que ninguna sesión lee. Cada problema tiene un botón "Copiar prompt de arreglo" para pegar en Claude Code. KevMind nunca edita esos archivos.
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

`npx kevmind clear` borra las sesiones de demo de los datos guardados; `npx kevmind clear --project <nombre>` borra el historial de un proyecto (por nombre de carpeta o ruta); `npx kevmind clear --all` borra todo (pregunta antes; `--yes` omite la pregunta). Los eventos se guardan en un archivo por mes (`events-AAAA-MM.jsonl`, meses en UTC); el `events.jsonl` único de versiones anteriores se divide por meses la primera vez que arranca el panel.

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

## Herramientas de experiencia para Claude (opcional)

KevMind también puede responder preguntas de Claude sobre la historia de un proyecto, con tres herramientas MCP incluidas en el plugin. Vienen **apagadas**. Actívalas con

```bash
npx kevmind tools on
```

o con el interruptor arriba del panel **Experiencia**, en la pestaña Memoria del panel. `kevmind tools off` las apaga y `kevmind tools status` muestra si están activas y de dónde viene ese ajuste. El ajuste se guarda en `~/.kevmind/config.json` y se aplica en la siguiente sesión de Claude Code. Mientras están apagadas, Claude no ve ninguna herramienta de KevMind, así que no gastan contexto.

Como alternativa, el plugin tiene la opción "Experience tools for Claude" (`experience_tools`) en `/config`. Cuando ambos están definidos gana el ajuste de KevMind, así que "apagado" siempre se respeta.

- `file_context(paths)`: archivos que suelen cambiar o leerse junto con los indicados.
- `file_history(path)`: en cuántos episodios de trabajo se leyó y editó un archivo, con qué tipos de agente, y cuántas veces git lo cambió o lo corrigió.
- `known_failures(command)`: fallos que el proyecto ya vio y qué pasó antes del siguiente éxito.

La evidencia viene de dos fuentes: el registro de KevMind del trabajo pasado de Claude Code, contado en episodios de trabajo, y el historial de git del proyecto (`git log` de solo lectura, últimos 365 días o 2,000 commits). Git solo basta para empezar, así que sirven desde el primer día en cualquier repositorio.

Un episodio de trabajo es un turno de prompt que termina con al menos una edición; sin prompts, un bloque de actividad separado del siguiente por más de 30 minutos. Las compactaciones y los mensajes del sistema no abren uno nuevo, así que una sola sesión larga deja muchos episodios. Además, cada patrón tiene que aparecer en al menos 2 días distintos, así que algo que solo se repite dentro de una conversación nunca califica. Cada resultado tiene su propio umbral; no hay un mínimo general por proyecto aparte de los 20 commits que necesita git.

Cada archivo pertenece al repositorio git que lo contiene. Si corres Claude en la raíz de un repositorio pero trabajas en `frontend/` y `backend/`, y esos son repositorios git separados, su historia se guarda y se responde por repositorio, y la respuesta nombra el repositorio del que viene. Nunca se responde por repositorios fuera de la carpeta donde corre Claude.

Cada respuesta:

- cita su fuente y sus conteos en una sola línea, primero los episodios, como "changes with `b.ts` (episodes: 5 on 2 days; git: 7 of 12 commits; last 2026-10-21)". Las fechas y los días usan la zona horaria local de tu computadora. Dos archivos consultados que cambian juntos se reportan una sola vez, como "usually change together";
- se queda por debajo de unos 400 tokens;
- dice "No data:" en vez de adivinar. Nada por debajo de umbrales fijos se entrega, por ejemplo "editados juntos en al menos 3 episodios, en 2 días distintos y en la mitad de los episodios que editaron el archivo", "leído antes en al menos 3 episodios" o "el mismo fallo en al menos 2 episodios en 2 días, con el mismo arreglo dos veces". Todos los umbrales están en `src/experience.js`.

KevMind solo reporta historia: nunca analiza código, no indexa símbolos y no escribe memoria, así que convive con Serena (para la estructura del código) y con la memoria automática de Claude. Las respuestas salen de `~/.kevmind/experience.json`, que el panel mantiene al día, y suelen tardar menos de 40 ms.

El panel **Experiencia**, en la pestaña Memoria, muestra lo que se entregaría hoy aunque las herramientas estén apagadas. Cuando Claude las usa, muestra las llamadas, los tokens entregados y qué tan seguido se abrió después un archivo sugerido, comparado con una referencia. Si tras 50 llamadas no supera la referencia, el panel recomienda apagarlas.

## Resumen de inicio de sesión (opcional)

Cada sesión nueva de Claude Code empieza de cero. Con el resumen encendido, KevMind le da a Claude una nota breve al empezar una sesión (una sesión nueva, `/clear` o tras una compactación), hecha solo con lo que ya registró y con git: dónde se quedó la última sesión con ediciones (los archivos que editó al final, una prueba o compilación que seguía fallando, subagentes que quedaron trabajando, su última respuesta), el último commit y lo que no está confirmado, los fallos que se repiten y qué los arregló, los archivos que se leen en cada sesión y las notas de memoria que los citan.

Son 1.500 caracteres como máximo (unos 350 tokens), escritos como hechos, nunca como instrucciones. No escribe nada en tu proyecto, en `CLAUDE.md` ni en la memoria de Claude. Está **apagado por defecto**: `npx kevmind briefing on` o el interruptor del panel **Resumen de inicio** en la pestaña Memoria.

**¿Ayuda?** La mitad de los inicios lo reciben y la otra mitad no, y se comparan: tiempo y pasos hasta la primera edición, archivos leídos de nuevo, fallos conocidos repetidos y tokens (entrada, salida y lecturas de caché, de la transcripción) hasta la primera edición y en todo el tramo. El panel muestra el texto exacto que recibió cada inicio y, tras 20 inicios medidos de cada lado, dice si ahorra tokens.

## Ver en tu teléfono

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
- La pestaña Memoria solo lee. Muestra metadatos, descripciones y encabezados, nunca el cuerpo completo de las notas. De la configuración global de Serena solo lee la lista de proyectos, nunca el `auth_secret`. Git se usa solo con `git ls-tree`, de solo lectura.
- De las transcripciones solo se guardan extractos de hasta 200 caracteres, enmascarados como todo lo demás. Las firmas del razonamiento nunca se leen y la transcripción nunca se copia.
- El resumen de inicio (apagado por defecto) usa los mismos registros más `git log` y `git status` de solo lectura. El texto de cada inicio se guarda en `~/.kevmind/briefings.jsonl` para que veas exactamente lo que recibió Claude; le llega como cualquier otro contexto.
- Las herramientas de experiencia no recolectan nada nuevo: leen el registro de eventos ya enmascarado y `git log`, solo del proyecto en el que trabaja Claude, y nunca escriben. `npx kevmind clear --project <nombre>` borra el historial de un proyecto.

Para cómo funciona, configuración, limitaciones y hoja de ruta, ver el [README en inglés](README.md).

## Licencia

MIT
