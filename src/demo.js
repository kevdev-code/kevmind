// Demo mode: simulates a session with parallel agents to try the dashboard without Claude Code.
// Everything it generates is tagged as project "demo-kevmind" (and a "demo-" session id) so it's never mistaken
// for real data. What Claude says and thinks comes from a small synthetic transcript in the temp folder, written
// as the demo goes and removed at the end.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

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
  const transcript = path.join(os.tmpdir(), `kevmind-${session_id}.jsonl`);
  fs.writeFileSync(transcript, '');
  const base = { session_id, cwd, transcript_path: transcript };
  const send = (e) => post(port, { ...base, ...e });
  const wait = (ms) => sleep(ms / speed);
  let n = 0;
  const id = () => `toolu_demo_${++n}`;
  let msg = 0;
  // One assistant turn in the transcript: a readable thought or a reply, with its token usage.
  const transcriptLine = (block, out) => fs.appendFileSync(transcript, JSON.stringify({
    type: 'assistant', timestamp: new Date().toISOString(),
    message: { model: 'claude-opus-5-5', id: `msg_demo_${++msg}`, role: 'assistant', content: [block],
      usage: { input_tokens: 2400 + msg * 310, output_tokens: out, cache_read_input_tokens: 18000 + msg * 4100, cache_creation_input_tokens: 1200 } },
  }) + '\n');
  const thinks = (text) => transcriptLine({ type: 'thinking', thinking: text }, 180);
  const says = (text) => transcriptLine({ type: 'text', text }, 90);
  const SERVICE = 'src/appointments/service.ts';

  try {
    await send({ hook_event_name: 'SessionStart', source: 'startup' });
    await send({ hook_event_name: 'UserPromptSubmit', prompt: 'Review the appointments module and add tests' });
    await wait(400);
    thinks('The service validates dates in two places. I should map who calls it before changing anything.');

    const r1 = id();
    await send({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: r1, tool_input: { file_path: `${cwd}/${SERVICE}` } });
    await wait(350);
    await send({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: r1, tool_response: {} });
    says("I'll split this into three parallel tasks: find the callers, write the tests, and review the validations.");
    await wait(300);

    // Launch 3 subagents in parallel
    const agents = [
      { t: id(), type: 'Explore', desc: 'Find usages of AppointmentService', files: ['src/appointments/controller.ts', 'src/calendar/calendar.ts'] },
      { t: id(), type: 'general-purpose', desc: 'Write unit tests', files: ['test/appointments.test.ts'] },
      { t: id(), type: 'code-reviewer', desc: 'Review date validations', files: [SERVICE] },
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
        const input = tool === 'Grep' ? { pattern: 'AppointmentService' } : tool === 'Bash' ? { command: 'npm test -- appointments', description: 'Run tests' } : { file_path: file };
        const t = id();
        await send({ hook_event_name: 'PreToolUse', agent_id, agent_type: a.type, tool_name: tool, tool_use_id: t, tool_input: input });
        await wait(300);
        if (tool === 'Bash') {
          await send({ hook_event_name: 'PostToolUseFailure', agent_id, agent_type: a.type, tool_name: tool, tool_use_id: t, tool_input: input, error: 'Exit code 1\nFAIL test/appointments.test.ts', is_interrupt: false });
        } else {
          await send({ hook_event_name: 'PostToolUse', agent_id, agent_type: a.type, tool_name: tool, tool_use_id: t, tool_response: {} });
        }
      }
      await wait(600);
    }

    // Conflict: the main agent edits the same file as the reviewer
    const e1 = id();
    await send({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: e1, tool_input: { file_path: `${cwd}/${SERVICE}` } });
    await send({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: e1, tool_response: {} });

    for (const a of agents) {
      await wait(600);
      await send({ hook_event_name: 'PostToolUse', tool_name: 'Task', tool_use_id: a.t, tool_response: {} });
    }
    says('Tests are written and one date check is fixed. Pushing needs your approval.');
    await wait(500);
    // Ends waiting for you: the panel turns amber and the tab says "Needs your OK" for a few seconds.
    await send({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' });
    await wait(5500);
    await send({ hook_event_name: 'Stop' });
  } finally {
    await sleep(1500); // the dashboard reads the transcript every second; let it catch the last lines
    fs.rmSync(transcript, { force: true });
  }
  return session_id;
}
