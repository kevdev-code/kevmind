# KevMind

Mira en vivo cómo trabaja Claude Code: qué hace, qué agentes lanza en paralelo, qué archivos toca y dónde falla. Todo corre en tu computadora; nada sale de ella.

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

`npx kevmind start --background` lo abre separado de la terminal, así sigue corriendo cuando la cierras (salida en `~/.kevmind/server.log`). `npx kevmind stop` cierra el panel en ejecución; `npx kevmind restart` lo cierra si está corriendo y lo vuelve a abrir tal como estaba.

`npx kevmind clear` borra las sesiones de demo de los datos guardados; `npx kevmind clear --all` borra todo (pregunta antes; `--yes` omite la pregunta).

### Probar sin Claude Code

```bash
npx kevmind demo
```

Simula una sesión con tres agentes en paralelo. Aparece como proyecto `demo-kevmind` para que no se confunda con datos reales.

## Privacidad

- Todo se queda en `~/.kevmind/`. No hay telemetría.
- Antes de guardar, se ocultan claves API, tokens de GitHub/AWS/Slack, JWT, llaves privadas y variables tipo `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`.
- El servidor solo escucha en `127.0.0.1`.
- Si el panel está apagado, el hook enmascara los eventos antes de guardarlos en `spool.jsonl`.
- De las transcripciones solo se guardan extractos de hasta 200 caracteres, enmascarados como todo lo demás. Las firmas del razonamiento nunca se leen y la transcripción nunca se copia.

Para cómo funciona, configuración, limitaciones y hoja de ruta, ver el [README en inglés](README.md).

## Licencia

MIT
