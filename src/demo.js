// Modo demo: simula una sesión con agentes en paralelo para probar el panel sin Claude Code.
// Todo lo que genera se marca como proyecto "demo-kevmind" para no confundirlo con datos reales.
import http from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(port, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request({ host: '127.0.0.1', port, path: '/events', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.end(body);
  });
}

export async function runDemo(port = 4777, speed = 1) {
  const session_id = `demo-${Date.now().toString(36)}`;
  const cwd = '/demo/demo-kevmind';
  const base = { session_id, cwd, transcript_path: '' };
  const send = (e) => post(port, { ...base, ...e });
  const wait = (ms) => sleep(ms / speed);
  let n = 0;
  const id = () => `toolu_demo_${++n}`;

  await send({ hook_event_name: 'SessionStart', source: 'startup' });
  await send({ hook_event_name: 'UserPromptSubmit', prompt: '[DEMO] Revisa el módulo de citas y agrega pruebas' });
  await wait(600);

  const r1 = id();
  await send({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: r1, tool_input: { file_path: `${cwd}/src/citas/service.ts` } });
  await wait(400);
  await send({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: r1, tool_response: {} });

  // Lanza 3 subagentes en paralelo
  const agents = [
    { t: id(), type: 'Explore', desc: 'Buscar usos de CitaService', files: ['src/citas/controller.ts', 'src/agenda/calendar.ts'] },
    { t: id(), type: 'general-purpose', desc: 'Escribir pruebas unitarias', files: ['test/citas.test.ts'] },
    { t: id(), type: 'general-purpose', desc: 'Revisar validaciones', files: ['src/citas/service.ts'] },
  ];
  for (const a of agents) {
    await send({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: a.t, tool_input: { subagent_type: a.type, description: a.desc, prompt: '...' } });
    await wait(250);
  }

  for (let step = 0; step < 3; step++) {
    for (const [i, a] of agents.entries()) {
      const agent_id = `demo-agent-${i + 1}`;
      const file = `${cwd}/${a.files[step % a.files.length]}`;
      const tool = step === 0 ? 'Read' : i === 0 ? 'Grep' : step === 2 && i === 1 ? 'Bash' : 'Edit';
      const input = tool === 'Grep' ? { pattern: 'CitaService' } : tool === 'Bash' ? { command: 'npm test', description: 'Correr pruebas' } : { file_path: file };
      const t = id();
      await send({ hook_event_name: 'PreToolUse', agent_id, agent_type: a.type, tool_name: tool, tool_use_id: t, tool_input: input });
      await wait(300);
      await send({ hook_event_name: 'PostToolUse', agent_id, agent_type: a.type, tool_name: tool, tool_use_id: t, tool_response: tool === 'Bash' && step === 2 ? { is_error: true } : {} });
    }
    await wait(700);
  }

  // Conflicto: el agente principal edita el mismo archivo que el agente 3
  const e1 = id();
  await send({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: e1, tool_input: { file_path: `${cwd}/src/citas/service.ts` } });
  await send({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: e1, tool_response: {} });

  for (const a of agents) {
    await wait(700);
    await send({ hook_event_name: 'PostToolUse', tool_name: 'Task', tool_use_id: a.t, tool_response: {} });
  }
  await send({ hook_event_name: 'Notification', message: '[DEMO] Claude necesita tu permiso para usar Bash' });
  await wait(1200);
  await send({ hook_event_name: 'Stop' });
  return session_id;
}
