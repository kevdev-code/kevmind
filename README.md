# KevMind

Mira en vivo cómo trabaja Claude Code: qué hace, qué agentes lanza en paralelo, qué archivos toca y dónde falla. Todo corre en tu computadora; nada sale a internet.

> Estado: **MVP (v0.1)**. Funciona el panel en vivo. El grafo de memoria y la vista "cerebro" vienen después (ver hoja de ruta).

## Qué muestra

- **Sesiones** de las últimas 24 h, por proyecto, con su estado (trabajando, en espera, espera tu OK).
- **Agentes en paralelo**: línea de tiempo de Claude y cada subagente que lanza, con cuántas acciones hizo cada uno.
- **Actividad en vivo**: cada lectura, edición, comando, búsqueda y llamada MCP al instante.
- **Archivos más tocados**: cuántas veces se leyó y editó cada uno.
- **Herramientas**: usos, errores y tiempo promedio.
- **Alertas de conflicto**: cuando dos agentes editan el mismo archivo con menos de 5 minutos de diferencia.

Es ligero: HTML y CSS normales, sin 3D ni GPU. Sin dependencias; solo Node 18 o superior.

## Instalación

### Opción A: como plugin de Claude Code (recomendado)

```bash
/plugin install <ruta-o-repo-de-kevmind>
```

El plugin registra los hooks solo. Después abre el panel:

```bash
npx kevmind
```

### Opción B: hooks manuales

```bash
npx kevmind install    # agrega los hooks a ~/.claude/settings.json (con respaldo)
npx kevmind            # abre el panel en http://localhost:4777
```

Para quitarlos: `npx kevmind uninstall`.

### Probar sin Claude Code

```bash
npx kevmind demo
```

Simula una sesión con tres agentes en paralelo. Aparece como proyecto `demo-kevmind` para que no se confunda con datos reales.

## Cómo funciona

```
Claude Code ──hook (stdin JSON)──▶ hooks/send.js ──POST──▶ servidor local :4777 ──SSE──▶ panel web
                                                                │
                                                                └─▶ ~/.kevmind/events.jsonl
```

1. Claude Code dispara hooks (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, etc.).
2. `send.js` reenvía el evento al servidor local. Si el servidor no está abierto, sale en silencio: **nunca bloquea a Claude**.
3. El servidor tapa secretos (tokens, claves, líneas `.env`), guarda el evento y lo manda al navegador.

## Privacidad

- Todo se queda en `~/.kevmind/`. No hay telemetría.
- Antes de guardar, se ocultan claves API, tokens de GitHub/AWS/Slack, JWT, llaves privadas y variables tipo `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`.
- El servidor solo escucha en `127.0.0.1`.

## Configuración

| Variable       | Por defecto   | Qué hace                  |
| -------------- | ------------- | ------------------------- |
| `KEVMIND_PORT` | `4777`        | Puerto del panel          |
| `KEVMIND_HOME` | `~/.kevmind`  | Dónde se guardan los datos |

## Limitaciones conocidas

- Para saber qué subagente hizo cada acción, KevMind usa el campo `agent_id` del hook si Claude Code lo envía. Si tu versión no lo manda, las acciones de los subagentes se atribuyen a "Claude", aunque la línea de tiempo de cuándo empieza y termina cada subagente sigue funcionando.
- Cada hook arranca un proceso de Node (unos 50 ms). No se nota en el uso normal.

## Hoja de ruta

- [ ] Tokens y costo por sesión y por agente (leyendo los transcripts).
- [ ] Repetir una sesión pasada paso a paso.
- [ ] Grafo de memoria: `CLAUDE.md` y notas, con detección de notas viejas, duplicadas o con enlaces rotos.
- [ ] Servidor MCP para que Claude consulte su propia memoria antes de trabajar.
- [ ] Sugerencias para `CLAUDE.md` según lo que Claude lee una y otra vez.
- [ ] Vista "cerebro" en 3D, opcional.

## Licencia

MIT
