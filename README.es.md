# KevMind

Mira en vivo cómo trabaja Claude Code: qué hace, qué agentes lanza en paralelo, qué archivos toca y dónde falla. Todo corre en tu computadora; nada sale de ella.

![Demo del panel de KevMind](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/kevmind-demo.gif)

[English](README.md) · **Español**

> Estado: **MVP (v0.1)**. El panel en vivo funciona. El grafo de memoria y la vista "cerebro" vienen después (ver hoja de ruta).

## Qué muestra

- **Sesiones** de las últimas 24 h, por proyecto, con su estado (trabajando, en espera, espera tu OK).
- **Agentes en paralelo**: línea de tiempo de Claude y cada subagente que lanza, con cuántas acciones hizo cada uno.
- **Actividad en vivo**: cada lectura, edición, comando, búsqueda y llamada MCP al instante.
- **Archivos más tocados**: cuántas veces se leyó y editó cada uno.
- **Herramientas**: usos, errores y tiempo promedio.
- **Alertas de conflicto**: cuando dos agentes editan el mismo archivo con menos de 5 minutos de diferencia.
- **Qué dice y qué piensa Claude**: extractos cortos de sus respuestas y de sus resúmenes de razonamiento legibles, leídos de la transcripción de la sesión, con un botón para ocultar los pensamientos. Si razonó pero no devolvió nada legible, el panel lo dice con la cantidad de tokens.
- **Tokens**: entrada, salida y caché (lectura/escritura) por sesión y por agente, contados una vez por llamada. Sin estimaciones de costo: los precios cambian.
- **Pestaña Memoria**: lo que Claude Code y Serena recuerdan de cada proyecto, con los problemas primero. Cubre los `CLAUDE.md` y sus importaciones, la memoria automática de Claude y las notas de Serena. Muestra cuánto contexto se carga al inicio de cada sesión, y marca enlaces e importaciones rotos, notas que faltan en `MEMORY.md`, un `MEMORY.md` que pasa el límite de 200 líneas / 25 KB, archivos de instrucciones demasiado largos, rutas desactualizadas, copias en worktrees, notas grandes, posibles duplicados y notas que ninguna sesión lee. Cada problema tiene un botón "Copiar prompt de arreglo" para pegar en Claude Code. KevMind nunca edita esos archivos.

El panel está en inglés y español (botón arriba a la derecha).

Es ligero: HTML y CSS normales, sin 3D ni GPU. Sin dependencias; solo Node 18 o superior.

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

KevMind también puede responder preguntas de Claude sobre la historia de un proyecto, con tres herramientas MCP incluidas en el plugin. Vienen **apagadas**; actívalas en `/config`, en el plugin kevmind ("Experience tools for Claude").

- `file_context(paths)`: archivos que suelen cambiar o leerse junto con los indicados.
- `file_history(path)`: cuántas sesiones leyeron y editaron un archivo, con qué tipos de agente, y cuántas veces git lo cambió o lo corrigió.
- `known_failures(command)`: fallos que el proyecto ya vio y qué pasó antes del siguiente éxito.

La evidencia viene de dos fuentes: el registro de KevMind de sesiones pasadas de Claude Code y el historial de git del proyecto (`git log` de solo lectura, últimos 365 días o 2,000 commits). Git solo basta para empezar, así que sirven desde el primer día en cualquier repositorio.

Cada respuesta:

- cita su fuente y sus conteos, como "sessions: 3 of 4" o "git: 6 of 9 commits"; la evidencia de sesiones va antes que la de git;
- se queda por debajo de unos 400 tokens;
- dice "No data:" en vez de adivinar. Nada por debajo de umbrales fijos se entrega, por ejemplo "editados juntos en al menos 3 sesiones, en 2 días distintos y en la mitad de las sesiones que editaron el archivo". Todos los umbrales están en `src/experience.js`.

KevMind solo reporta historia: nunca analiza código, no indexa símbolos y no escribe memoria, así que convive con Serena (para la estructura del código) y con la memoria automática de Claude. Las respuestas salen de `~/.kevmind/experience.json`, que el panel mantiene al día, y suelen tardar menos de 40 ms.

El panel **Experiencia**, en la pestaña Memoria, muestra lo que se entregaría hoy aunque las herramientas estén apagadas. Cuando Claude las usa, muestra las llamadas, los tokens entregados y qué tan seguido se abrió después un archivo sugerido, comparado con una referencia. Si tras 50 llamadas no supera la referencia, el panel recomienda apagarlas.

## Privacidad

- Todo se queda en `~/.kevmind/`. No hay telemetría.
- Antes de guardar, se ocultan claves API, tokens de GitHub/AWS/Slack, JWT, llaves privadas y variables tipo `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`.
- El servidor solo escucha en `127.0.0.1`.
- Si el panel está apagado, el hook enmascara los eventos antes de guardarlos en `spool.jsonl`.
- La pestaña Memoria solo lee. Muestra metadatos, descripciones y encabezados, nunca el cuerpo completo de las notas. De la configuración global de Serena solo lee la lista de proyectos, nunca el `auth_secret`. Git se usa solo con `git ls-tree`, de solo lectura.
- De las transcripciones solo se guardan extractos de hasta 200 caracteres, enmascarados como todo lo demás. Las firmas del razonamiento nunca se leen y la transcripción nunca se copia.
- Las herramientas de experiencia no recolectan nada nuevo: leen el registro de eventos ya enmascarado y `git log`, solo del proyecto en el que trabaja Claude, y nunca escriben. `npx kevmind clear --project <nombre>` borra el historial de un proyecto.

Para cómo funciona, configuración, limitaciones y hoja de ruta, ver el [README en inglés](README.md).

## Licencia

MIT
