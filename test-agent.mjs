// Проверка без Claude: изображает одного агента. Запуск: node test-agent.mjs ИМЯ
// Он приходит с улицы, работает, запускает двух субагентов (один из них ловит ошибку инструмента),
// просит разрешение, снова работает, сидит без дела и уходит.
// Контекст растёт по ходу: 40k → 130k → 180k → 195k токенов (из 200k), так что стопка бумаг у стола растёт.
const name = process.argv[2] || 'TEST';
const id = `test-${name}-${Date.now()}`;
const steps = [
  [0, { hook_event_name: 'SessionStart' }],
  [4, { hook_event_name: 'UserPromptSubmit', ctx_tokens: 40000 }],
  [3, { hook_event_name: 'PreToolUse', tool_name: 'Task' }],
  [1, { hook_event_name: 'SubagentStart', agent_id: 'sub-a', agent_type: 'Explore' }],
  [0, { hook_event_name: 'SubagentStart', agent_id: 'sub-b', agent_type: 'Plan' }],
  [4, { hook_event_name: 'PreToolUse', agent_id: 'sub-a', agent_type: 'Explore', tool_name: 'Grep', detail: 'TODO' }],
  [2, { hook_event_name: 'PreToolUse', agent_id: 'sub-b', agent_type: 'Plan', tool_name: 'Read', detail: 'App.tsx' }],
  [3, { hook_event_name: 'PostToolUseFailure', agent_id: 'sub-b', agent_type: 'Plan', tool_name: 'Read' }],
  [4, { hook_event_name: 'SubagentStop', agent_id: 'sub-a', agent_type: 'Explore' }],
  [4, { hook_event_name: 'SubagentStop', agent_id: 'sub-b', agent_type: 'Plan' }],
  [2, { hook_event_name: 'PostToolUse', tool_name: 'Task', ctx_tokens: 130000 }],
  [3, { hook_event_name: 'PreToolUse', tool_name: 'Bash' }],
  [4, { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash' }],
  [6, { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' }],
  [6, { hook_event_name: 'PostToolUse', tool_name: 'Bash', ctx_tokens: 180000 }],
  [4, { hook_event_name: 'UserPromptSubmit', ctx_tokens: 195000 }],
  [5, { hook_event_name: 'Stop', ctx_tokens: 195000 }],
  [50, { hook_event_name: 'SessionEnd' }],
];
for (const [wait, ev] of steps) {
  await new Promise(r => setTimeout(r, wait * 1000));
  const body = { agent: 'claude', session_id: id, cwd: `C:/test/${name}`, ...ev };
  try {
    await fetch(`http://127.0.0.1:${process.env.OFFICE_PORT || 7777}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    console.log(name, ev.hook_event_name, ev.agent_type ? `[${ev.agent_type}]` : '', ev.tool_name || '');
  } catch { console.log('Сервер не запущен: сначала start-office.cmd'); process.exit(1); }
}
