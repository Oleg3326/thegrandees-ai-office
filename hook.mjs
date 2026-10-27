// Хук для Claude Code и Codex: читает событие из stdin и отправляет короткую сводку на сервер офиса.
// Аргумент: claude или codex (кто запустил хук).
// Полный текст запросов и команд НЕ отправляется. Кроме id сессии, папки, события и имени инструмента
// уходит только короткая подпись (detail): имя файла, первые слова команды, домен сайта
// или первые 6 символов запроса с «…». Всё остаётся на этом компьютере (127.0.0.1).
// Добавлено в форке: для субагентов уходят agent_id и agent_type (например «Explore»), а для Claude Code ещё
// одно число: сколько токенов сейчас в контексте (берётся из конца файла транскрипта, сам текст не читается дальше
// поиска поля usage и никуда не отправляется).
// Всегда выходит с кодом 0, чтобы никогда не мешать работе Claude, даже если сервер выключен.
import fs from 'node:fs';
const URL = `http://127.0.0.1:${process.env.OFFICE_PORT || 7777}/event`;
setTimeout(() => process.exit(0), 2000);

// Сколько токенов сейчас в контексте основного диалога: usage последнего ответа ассистента.
// Читаем только хвост файла (последние ~128 КБ), чтобы не тормозить на больших сессиях.
function ctxTokens(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size, len = Math.min(size, 128 * 1024), buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"usage"')) continue;
        let j; try { j = JSON.parse(lines[i]); } catch { continue; }   // первая строка хвоста может быть обрезана
        const u = j?.message?.usage;
        if (j?.type !== 'assistant' || j?.isSidechain || !u) continue;
        const n = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (n > 0) return n;
      }
    } finally { fs.closeSync(fd); }
  } catch {}
  return undefined;
}
const CTX_EVENTS = new Set(['UserPromptSubmit', 'PostToolUse', 'Stop']);

// короткая подпись того, что агент делает сейчас
const clip = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const base = f => String(f).split(/[\\/]/).filter(Boolean).pop() || '';
function detailOf(ev) {
  try {
    if (ev.hook_event_name === 'UserPromptSubmit') return clip(ev.prompt, 6) || undefined;
    if (ev.hook_event_name !== 'PreToolUse' && ev.hook_event_name !== 'PermissionRequest') return undefined;
    const ti = ev.tool_input || {};
    const f = ti.file_path || ti.notebook_path || ti.path;
    if (f) return clip(base(f), 22);
    if (ti.command) {
      const w = String(Array.isArray(ti.command) ? ti.command.join(' ') : ti.command).trim().split(/\s+/);
      const cmd = base(w[0]).replace(/\.(exe|cmd)$/i, '');
      return clip(/^(git|npm|npx|dotnet|pnpm|yarn|cargo|go|python3?|pip|node)$/.test(cmd) && w[1] ? `${cmd} ${w[1]}` : cmd, 18);
    }
    if (ti.url) { try { return new globalThis.URL(ti.url).hostname.replace(/^www\./, '').slice(0, 22); } catch { return undefined; } }
    if (ti.query || ti.pattern) return clip(ti.query || ti.pattern, 6);
    if (ti.description) return clip(ti.description, 10);
  } catch {}
  return undefined;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', async () => {
  try {
    const ev = JSON.parse(raw);
    const body = {
      detail: detailOf(ev),
      agent: process.argv[2] === 'codex' ? 'codex' : 'claude',
      ppid: process.ppid,
      session_id: ev.session_id,
      hook_event_name: ev.hook_event_name,
      cwd: ev.cwd,
      tool_name: ev.tool_name,
      notification_type: ev.notification_type,
      message: ev.hook_event_name === 'Notification' ? ev.message : undefined,
      agent_id: ev.agent_id ? String(ev.agent_id).slice(0, 60) : undefined,
      agent_type: ev.agent_type ? clip(ev.agent_type, 24) : undefined,
      ctx_tokens: process.argv[2] !== 'codex' && !ev.agent_id && CTX_EVENTS.has(ev.hook_event_name) && ev.transcript_path ? ctxTokens(ev.transcript_path) : undefined,
    };
    await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(800),
    });
  } catch { /* сервер не запущен: молча выходим */ }
  process.exit(0);
});
