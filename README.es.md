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

El panel está en inglés y español (botón arriba a la derecha).

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

## Privacidad

- Todo se queda en `~/.kevmind/`. No hay telemetría.
- Antes de guardar, se ocultan claves API, tokens de GitHub/AWS/Slack, JWT, llaves privadas y variables tipo `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`.
- El servidor solo escucha en `127.0.0.1`.

Para cómo funciona, configuración, limitaciones y hoja de ruta, ver el [README en inglés](README.md).

## Licencia

MIT
