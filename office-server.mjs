// Локальный сервер AI-офиса.
// 1) Каждые 4 секунды смотрит, какие AI-программы открыты: Claude Code, приложение Claude, Codex, ChatGPT.
//    Ollama сидит в офисе, пока она открыта; «работает», пока грузит процессор или модель только что отвечала (GET /api/ps).
//    Пока процесс открыт, его агент сидит в офисе. Закрыл окно: агент уходит.
// 2) Хуки Claude Code и Codex присылают события (POST /event): работает, ждёт тебя, закончил.
//    У ChatGPT и приложения Claude хуков нет: «работает» определяется по нагрузке на процессор.
// Обои читают GET /state. Слушает только 127.0.0.1, снаружи не виден.
// 3) Сам не висит без дела:
//    OFFICE_WITH_WE=1 (Windows, запуск из watch.vbs): выходит, когда Wallpaper Engine закрыт и обои давно не спрашивали;
//    OFFICE_WITH_PARENT=1 (приложение на Mac): выходит, как только закрылось приложение (закрылся stdin).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.OFFICE_PORT || 7777);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const SCAN_MS = 4000;
const CPU_BUSY = 0.05;              // доля одного ядра, выше которой считаем, что программа «думает»

const WITH_WE = process.env.OFFICE_WITH_WE === '1';
const IDLE_MS = 30e3;               // обои не спрашивали 30 с: сканируем редко
const LABEL = { claude: 'Claude Code', 'claude-app': 'Claude', codex: 'Codex', chatgpt: 'ChatGPT', ollama: 'Ollama',
  gemini: 'Gemini', grok: 'Grok', deepseek: 'DeepSeek', qwen: 'Qwen', mistral: 'Mistral', perplexity: 'Perplexity', copilot: 'Copilot' };
// інші ШІ: настільні програми та CLI; кожен вид — один агент, статус «працює» за навантаженням процесора
const OTHER = ['gemini', 'grok', 'deepseek', 'qwen', 'mistral', 'perplexity', 'copilot'];
const OTHER_RE = [
  ['gemini', /^gemini(\.exe)?$/, /\/gemini\.app\//, /@google[\\/]gemini-cli/],
  ['grok', /^grok(\.exe)?$/, /\/grok\.app\//, /grok-cli/],
  ['deepseek', /^deepseek/, /\/deepseek\.app\//, null],
  ['qwen', /^qwen(\.exe)?$/, /\/qwen\.app\//, /@qwen-code[\\/]qwen-code/],
  ['mistral', /^(le ?chat|mistral|vibe(\.exe)?$)/, /\/(le chat|mistral)[^/]*\.app\//, /mistral[-_]vibe/],
  ['perplexity', /^perplexity/, /\/perplexity\.app\//, null],
  ['copilot', /^(microsoft ?|m365)?copilot(\.exe)?$/, /\/(microsoft )?copilot\.app\//, /@github[\\/]copilot/],
];

// ---------- процессы ----------
let procTable = new Map();           // pid -> { pid, ppid, name, kind? }
const procAgents = new Map();        // pid корня -> { pid, kind, firstSeen, cpuPrev, busyUntil, cpuBusy }
let lastScanOk = false;

function kindOf(p, table) {
  const n = (p.name || '').toLowerCase(), exe = (p.exe || '').toLowerCase(), cmd = (p.cmd || '').toLowerCase();
  if (n === 'chatgpt.exe') return 'chatgpt';
  if (/^codex.*\.exe$/.test(n)) return 'codex';
  if (/^ollama/.test(n) || exe.includes('/ollama.app/')) return 'ollama';   // ollama.exe, «ollama app.exe», ollama_llama_server, Ollama.app
  if (n === 'claude.exe') {
    const desktopPath = exe.includes('anthropicclaude') || exe.includes('\\windowsapps\\') || /\\claude\\app-/.test(exe);
    if (!desktopPath) return 'claude';
    const parent = table.get(p.ppid);
    const parentIsApp = parent && (parent.name || '').toLowerCase() === 'claude.exe';
    if (parentIsApp && !cmd.includes('--type=')) return 'claude';   // сессия Claude Code внутри приложения
    return 'claude-app';
  }
  // macOS / Linux: имена без .exe, программы лежат в *.app
  if (!n.endsWith('.exe')) {
    if (exe.includes('/chatgpt.app/')) return 'chatgpt';
    if (n === 'claude') return 'claude';
    if (/^codex/.test(n) || exe.includes('/codex.app/')) return 'codex';
    if (exe.includes('/claude.app/')) return 'claude-app';
  }
  if (n === 'node.exe' || n === 'node') {
    if (/claude-code|@anthropic-ai[\\/]claude/.test(cmd)) return 'claude';
    if (/@openai[\\/]codex/.test(cmd)) return 'codex';
  }
  for (const [k, name, app, line] of OTHER_RE) if (name.test(n) || app.test(exe) || (line && line.test(cmd))) return k;
  return null;
}

function scanWindows() {
  const ps = `$i='^(claude|codex.*|chatgpt|node|ollama.*|gemini.*|grok.*|deepseek.*|qwen.*|le ?chat.*|mistral.*|vibe|perplexity.*|m365copilot.*|copilot|microsoft ?copilot)\\.exe$'
Get-CimInstance Win32_Process | ForEach-Object {
 if ($_.Name -match $i) { [pscustomobject]@{i=$_.ProcessId;p=$_.ParentProcessId;n=$_.Name;e=$_.ExecutablePath;c=$_.CommandLine;t=$_.KernelModeTime+$_.UserModeTime} }
 else { [pscustomobject]@{i=$_.ProcessId;p=$_.ParentProcessId;n=$_.Name} } } | ConvertTo-Json -Compress`;
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 10000, maxBuffer: 32e6 }, (err, out) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(out).map(x => ({ pid: x.i, ppid: x.p, name: x.n, exe: x.e, cmd: x.c, cpu: (x.t || 0) / 1e7 }))); }
      catch { resolve(null); }
    });
  });
}

// macOS и Linux: два вызова ps (путь к программе может содержать пробелы, поэтому отдельно от аргументов).
const run = (cmd, args) => new Promise(r => execFile(cmd, args, { timeout: 10000, maxBuffer: 32e6 }, (e, out) => r(e ? null : out)));
const secs = t => String(t).split(/[-:]/).map(Number).reverse().reduce((s, v, i) => s + v * [1, 60, 3600, 86400][i], 0);
async function scanPosix() {
  const [a, b] = await Promise.all([run('ps', ['-axww', '-o', 'pid=,ppid=,time=,comm=']), run('ps', ['-axww', '-o', 'pid=,args='])]);
  if (!a || !b) return null;
  const args = new Map();
  for (const l of b.split('\n')) { const m = l.match(/^\s*(\d+)\s+(.*)$/); if (m) args.set(+m[1], m[2]); }
  const list = [];
  for (const l of a.split('\n')) {
    const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const exe = m[4].trim();
    list.push({ pid: +m[1], ppid: +m[2], name: exe.split('/').pop(), exe, cmd: args.get(+m[1]) || '', cpu: secs(m[3]) });
  }
  return list;
}

// Для проверки на другой ОС: OFFICE_PROCS_FILE=файл.json со списком {pid, ppid, name, exe, cmd, cpu}.
async function scanProcs() {
  if (process.env.OFFICE_PROCS_FILE) {
    try { return JSON.parse(fs.readFileSync(process.env.OFFICE_PROCS_FILE, 'utf8')); } catch { return null; }
  }
  if (process.platform === 'win32') return scanWindows();
  return scanPosix();
}

let scanning = false;
async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const list = await scanProcs();
    lastScanOk = !!list;
    if (!list) return;
    if (WITH_WE) {
      const we = list.some(p => /^wallpaper(32|64)\.exe$/i.test(p.name || ''));
      if (!we && Date.now() - lastPoll > 60e3) { console.log('Wallpaper Engine закрыт: выключаюсь.'); process.exit(0); }
    }
    const table = new Map(list.map(p => [p.pid, p]));
    for (const p of list) p.kind = kindOf(p, table);
    // открытые `ollama run <модель>`: модель считается запущенной, даже если Ollama уже выгрузила её из памяти
    ollama.running = list.map(p => (p.cmd || '').match(/ollama(?:\.exe)?"?\s+run\s+([^\s"]+)/i)?.[1]).filter(Boolean).map(m => m.replace(/:latest$/, ''));
    procTable = table;
    // корень группы: процесс нужного вида, у которого родитель другого вида (вкладки Electron и дочерние процессы схлопываются)
    const roots = new Map();
    for (const p of list) {
      if (!p.kind) continue;
      let root = p;
      for (let up = table.get(p.ppid), guard = 0; up && up.kind === p.kind && guard < 20; up = table.get(up.ppid), guard++) root = up;
      // Codex запускает много отдельных процессов: все они один агент (ключ -1).
      const key = root.kind === 'codex' ? -1 : root.kind === 'ollama' ? -2 : OTHER.includes(root.kind) ? -10 - OTHER.indexOf(root.kind) : root.pid;   // Ollama: трей, сервер и раннер — тоже один агент
      const r = roots.get(key) || { pid: key, kind: root.kind, cpu: 0 };
      r.cpu += p.cpu || 0;
      roots.set(key, r);
    }
    const now = Date.now();
    for (const [pid, r] of roots) {
      let a = procAgents.get(pid);
      if (!a) { a = { pid, kind: r.kind, firstSeen: now, cpuPrev: r.cpu, cpuBusy: false, busyUntil: 0 }; procAgents.set(pid, a); continue; }
      const load = (r.cpu - a.cpuPrev) / (SCAN_MS / 1000);
      a.cpuPrev = r.cpu;
      if (load > CPU_BUSY) a.busyUntil = now + 20e3;     // после всплеска считаем занятым ещё 20 секунд
      a.cpuBusy = now < a.busyUntil;
    }
    for (const pid of [...procAgents.keys()]) if (!roots.has(pid)) procAgents.delete(pid);
    await ollamaScan();
  } finally { scanning = false; }
}

// ---------- Ollama ----------
// Лама сидит в офисе, пока Ollama открыта (как и другие ИИ: программа открыта, агент на месте).
// «Работает», пока модель отвечает. В табличке название загруженной (или последней) модели.
const OLLAMA = (() => { const h = process.env.OLLAMA_HOST || ''; const m = h.match(/:(\d+)\/?$/); return `http://127.0.0.1:${m ? m[1] : 11434}`; })();
const ollama = { up: false, models: [], running: [], last: '', key: '', busyUntil: 0 };
async function ollamaScan() {
  try {
    const r = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(1500) });
    const models = (await r.json()).models || [];
    const key = models.map(m => `${m.name} ${m.expires_at}`).join('|');
    if (models.length && key !== ollama.key) ollama.busyUntil = Date.now() + 20e3;   // новый запрос продлевает модель: значит, она только что отвечала
    ollama.key = key; ollama.models = models.map(m => (m.name || '').replace(/:latest$/, ''));
    ollama.up = true; if (ollama.models[0]) ollama.last = ollama.models[0];
  } catch { ollama.up = false; ollama.models = []; ollama.key = ''; }
}
// Пока обои спрашивают /state, сканируем каждые 4 с. Обои на паузе или закрыты: раз в 30 с, почти без нагрузки.
let lastPoll = Date.now(), lastScan = 0;
setInterval(() => {
  const now = Date.now();
  if (now - lastPoll < IDLE_MS || now - lastScan >= IDLE_MS) { lastScan = now; scan(); }
}, SCAN_MS);
scan();
if (process.env.OFFICE_WITH_PARENT === '1') {
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
  process.stdin.resume();
}

// ---------- автообновление ----------
// Установленный офис (OFFICE_VERSION_FILE задаёт установщик) регулярно сверяет свою версию с GitHub.
// Если вышла новая, тихо запускает тот же установщик: он обновит файлы и перезапустит сервер.
const REPO = 'AlexanderGrandees/thegrandees-ai-office';
const VERSION_FILE = process.env.OFFICE_VERSION_FILE;
// Версия = коммит. Windows: последний коммит ветки main; Mac: коммит, из которого собрано готовое приложение.
// Оба адреса не GitHub API, поэтому без лимита запросов.
async function latestVersion() {
  const headers = { 'user-agent': 'tgti-ai-office' };
  if (process.platform === 'darwin') {
    const r = await fetch(`https://github.com/${REPO}/releases/download/mac-latest/VERSION`, { headers });
    return r.ok ? (await r.text()).trim() : null;
  }
  const r = await fetch(`https://github.com/${REPO}.git/info/refs?service=git-upload-pack`, { headers });
  return r.ok ? (await r.text()).match(/([0-9a-f]{40}) refs\/heads\/main/)?.[1] : null;
}
const updLog = t => { try { fs.appendFileSync(path.join(path.dirname(VERSION_FILE), 'update.log'), `${new Date().toISOString()} ${t}\n`); } catch {} };
let updatingUntil = 0;
async function checkUpdate() {
  if (Date.now() < updatingUntil) return;                      // установщик уже работает
  try {
    const mine = fs.readFileSync(VERSION_FILE, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!mine || mine === 'local') return;                     // ручная или тестовая установка: не трогаем
    const latest = await latestVersion();
    if (!latest) return updLog('не смог узнать новую версию');
    if (latest === mine) return;
    updLog(`новая версия ${latest} (была ${mine}): запускаю установщик`);
    updatingUntil = Date.now() + 5 * 60e3;
    const log = path.join(path.dirname(VERSION_FILE), 'update.log');
    if (process.platform === 'win32') {
      // установщик сам остановит этот сервер, поэтому обновление идёт отдельным скрытым процессом (update.vbs → update.ps1)
      spawn('wscript.exe', [path.join(path.dirname(VERSION_FILE), 'update.vbs')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      const out = fs.openSync(log, 'a');
      spawn('/bin/bash', ['-c', `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/macos/install.sh | TGTI_UPDATE=1 bash`], { detached: true, stdio: ['ignore', out, out] }).unref();
    }
  } catch (e) { if (VERSION_FILE) updLog(`ошибка: ${e.message}`); }   // нет сети: попробуем позже
}
// ФОРК: автообновление выключено. Оригинал каждые 15 секунд сверялся с репозиторием автора и ставил его код поверх,
// то есть затёр бы любые правки. Включить обратно можно только явно: OFFICE_ALLOW_UPDATE=1.
const UPDATE_EVERY = 15e3;
if (VERSION_FILE && process.env.OFFICE_ALLOW_UPDATE === '1') { setTimeout(checkUpdate, 15e3); setInterval(checkUpdate, UPDATE_EVERY); }
const myVersion = () => { try { return fs.readFileSync(VERSION_FILE, 'utf8').replace(/^\uFEFF/, '').trim(); } catch { return ''; } };

// ---------- сессии из хуков ----------
const sessions = new Map();
const MAX_SUBS_PER_SESSION = 4;     // сколько субагентов одной сессии рисуем (столов в офисе всего 8)
const SUB_MIN_SHOW = 8e3;           // даже самый быстрый субагент виден минимум 8 с: успеет дойти до стола
const SUB_LINGER = 3e3;             // и ещё 3 с после завершения
const ERR_SHOW = 8e3;               // сколько секунд бот «красный» после ошибки инструмента
const endSubs = (s, now) => { for (const x of s.subs.values()) x.endAt ||= now; };
// Доля заполненного контекста. Окно угадываем: больше 200k токенов в контексте значит, окно миллионное.
// Если окно у тебя другое: OFFICE_CTX_MAX=число.
const ctxMax = n => Number(process.env.OFFICE_CTX_MAX) || (n > 200e3 ? 1e6 : 200e3);
const ctxFrac = s => s.ctxTokens > 0 ? Math.min(1, s.ctxTokens / ctxMax(s.ctxTokens)) : undefined;

function folderOf(cwd) { return String(cwd || '').split(/[\\/]/).filter(Boolean).pop()?.slice(0, 24) || ''; }

function apply(ev) {
  const id = String(ev.session_id || '').slice(0, 80);
  if (!id) return;
  const now = Date.now();
  let s = sessions.get(id);
  if (!s) { s = { id, kind: ev.agent === 'codex' ? 'codex' : 'claude', folder: '', status: 'idle', tool: '', detail: '', last: now, ppid: 0, pid: 0, subs: new Map(), dead: new Set(), errAt: 0, ctxTokens: 0 }; sessions.set(id, s); }
  if (ev.cwd) s.folder = folderOf(ev.cwd);
  if (ev.ppid) s.ppid = Number(ev.ppid);
  s.last = now;
  const msg = String(ev.message || '');
  const detail = String(ev.detail || '').slice(0, 24);
  if (Number(ev.ctx_tokens) > 0) s.ctxTokens = Math.min(Number(ev.ctx_tokens), 5e6);

  // Субагенты (Claude Code): события внутри субагента приходят с agent_id и относятся к нему, а не к родителю.
  const aid = ev.agent_id ? String(ev.agent_id).slice(0, 60) : '';
  if (aid) {
    let sub = s.subs.get(aid);
    if (ev.hook_event_name === 'SubagentStop') { if (sub) sub.endAt = sub.endAt || now; return; }
    if (!sub) {
      if (s.dead.has(aid) || s.subs.size >= MAX_SUBS_PER_SESSION) return;   // уже ушёл (запоздавшее событие) или слишком много: не рисуем
      sub = { id: aid, type: String(ev.agent_type || 'agent').slice(0, 24), status: 'working', tool: '', detail: '', started: now, last: now, endAt: 0, errAt: 0 };
      s.subs.set(aid, sub);
    }
    sub.last = now;
    switch (ev.hook_event_name) {
      case 'PreToolUse': sub.status = 'working'; sub.tool = String(ev.tool_name || '').slice(0, 40); sub.detail = detail; break;
      case 'PermissionRequest': sub.status = 'waiting'; sub.tool = String(ev.tool_name || '').slice(0, 40); sub.detail = detail; break;
      case 'PostToolUse': sub.status = 'working'; break;
      case 'PostToolUseFailure': sub.errAt = now; break;
    }
    return;
  }
  switch (ev.hook_event_name) {
    case 'SessionStart': s.status = 'idle'; s.tool = ''; s.detail = ''; break;
    case 'UserPromptSubmit': s.status = 'working'; s.tool = 'думает'; s.detail = detail; break;
    case 'PreToolUse': s.status = 'working'; s.tool = String(ev.tool_name || '').slice(0, 40); s.detail = detail; break;
    case 'PostToolUse': s.status = 'working'; break;
    case 'PostToolUseFailure': s.errAt = now; break;       // инструмент упал: бот на пару секунд «краснеет»
    case 'PermissionRequest': s.status = 'waiting'; s.tool = String(ev.tool_name || '').slice(0, 40); s.detail = detail; break;
    case 'Notification':
      if (ev.notification_type === 'idle_prompt' || /waiting for your input/i.test(msg)) { s.status = 'idle'; s.tool = ''; }
      else { s.status = 'waiting'; s.tool = msg.slice(0, 80); }
      break;
    case 'Stop': s.status = 'idle'; s.tool = ''; s.detail = ''; endSubs(s, now); break;
    case 'SessionEnd': s.status = 'gone'; endSubs(s, now); break;
  }
  if (s.ppid && !procTable.has(s.ppid)) scan();
}

// К какому открытому процессу относится сессия: ищем вверх по родителям от процесса, запустившего хук.
function linkSession(s) {
  if (s.pid && procAgents.has(s.pid)) return s.pid;
  for (let pid = s.ppid, guard = 0; pid && guard < 30; guard++) {
    if (procAgents.has(pid)) return (s.pid = pid);
    const p = procTable.get(pid);
    if (!p) break;
    if (p.kind === 'codex' && procAgents.has(-1)) return (s.pid = -1);
    pid = p.ppid;
  }
  return 0;
}

// Уборка: закрытые сессии убираем через 15 с, совсем тихие через 30 мин, «работает» без событий 10 мин = отдых.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const quiet = now - s.last;
    if ((s.status === 'gone' && quiet > 15e3) || quiet > 30 * 60e3) { sessions.delete(id); continue; }
    else if (s.status === 'working' && quiet > 10 * 60e3) { s.status = 'idle'; s.tool = ''; }
    for (const [sid, x] of s.subs) {
      const over = x.endAt ? now > Math.max(x.endAt + SUB_LINGER, x.started + SUB_MIN_SHOW) : now - x.last > 15 * 60e3;   // без событий 15 мин: подвис, убираем
      if (over) { s.subs.delete(sid); s.dead.add(sid); if (s.dead.size > 200) s.dead.delete(s.dead.values().next().value); }
    }
  }
}, 10e3);

// Субагенты сессии как отдельные записи: тот же вид (цвет), флаг sub, своя подпись по типу («Explore», «Plan»…).
function subRows(s, parentId, kind, now) {
  return [...s.subs.values()].sort((a, b) => a.started - b.started).map(x => {
    const done = x.endAt && now >= x.endAt;
    return { id: `${parentId}:sub:${x.id}`, kind, sub: true, subType: x.type, name: `${LABEL[kind]} › ${x.type}`,
      status: done ? 'idle' : x.status, tool: done ? '' : x.tool, detail: done ? '' : x.detail, hooks: true, err: now - x.errAt < ERR_SHOW };
  });
}

function state() {
  const now = Date.now();
  const byPid = new Map();
  const live = [...sessions.values()].filter(s => s.status !== 'gone').sort((a, b) => b.last - a.last);
  const unlinked = [];
  for (const s of live) {
    const pid = linkSession(s);
    if (pid && !byPid.has(pid)) byPid.set(pid, s); else if (!pid) unlinked.push(s);
  }
  // Не нашли родителя (например, хук запущен через оболочку, которая уже закрылась): пара по виду программы.
  for (const s of unlinked) {
    const free = [...procAgents.values()].filter(a => a.kind === s.kind && !byPid.has(a.pid)).sort((a, b) => b.firstSeen - a.firstSeen)[0];
    if (free) { byPid.set(free.pid, s); s.pid = free.pid; }
  }
  const out = [];
  for (const a of [...procAgents.values()].sort((x, y) => x.firstSeen - y.firstSeen)) {
    if (a.kind === 'ollama') continue;                  // лама добавляется ниже, по загруженной модели
    const s = byPid.get(a.pid);
    const fresh = s && now - s.last < 10 * 60e3;
    const id = `${a.kind}-${a.pid}`;
    out.push({
      id,
      kind: a.kind,
      name: LABEL[a.kind] + (s?.folder ? ` · ${s.folder}` : ''),
      status: fresh ? s.status : (a.cpuBusy ? 'working' : 'idle'),
      tool: fresh ? s.tool : '',
      detail: fresh && s.status !== 'idle' ? s.detail : '',
      hooks: !!s,
      ctx: fresh ? ctxFrac(s) : undefined,
      err: !!fresh && now - s.errAt < ERR_SHOW,
    });
    if (fresh && s.subs.size) out.push(...subRows(s, id, a.kind, now));
  }
  // лама в офисе, пока Ollama открыта (сервер отвечает или виден её процесс); работает, пока модель отвечает
  const model = ollama.models[0] || ollama.running[0] || ollama.last;
  if (ollama.up || procAgents.has(-2) || ollama.running.length) {
    const busy = procAgents.get(-2)?.cpuBusy || now < ollama.busyUntil;
    out.push({ id: 'ollama', kind: 'ollama', name: model ? `Ollama · ${model}` : 'Ollama', status: busy ? 'working' : 'idle', tool: '', detail: model, hooks: false });
  }
  // Сессия без найденного процесса (или сканирование недоступно): показываем, пока от неё были события за 2 минуты.
  const linked = new Set(byPid.values());
  for (const s of live) if (!linked.has(s) && (!lastScanOk || now - s.last < 120e3)) {
    out.push({ id: s.id, kind: s.kind, name: LABEL[s.kind] + (s.folder ? ` · ${s.folder}` : ''), status: s.status, tool: s.tool, detail: s.status !== 'idle' ? s.detail : '', hooks: true, ctx: ctxFrac(s), err: now - s.errAt < ERR_SHOW });
    if (s.subs.size) out.push(...subRows(s, s.id, s.kind, now));
  }
  return out;
}

const nowMs = () => Date.now();
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Private-Network': 'true',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method === 'POST' && req.url === '/event') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64e3) req.destroy(); });
    req.on('end', () => {
      try { apply(JSON.parse(body)); } catch { /* битое событие просто пропускаем */ }
      res.writeHead(204, CORS); res.end();
    });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/state')) {
    if (nowMs() - lastPoll >= IDLE_MS) setTimeout(scan, 0);   // обои проснулись: сразу свежий список
    lastPoll = nowMs();
    res.writeHead(200, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ agents: state(), scan: lastScanOk, now: Date.now(), version: VERSION_FILE ? myVersion() : '' }));
  }
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index.html'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(DIR, 'index.html')).pipe(res);
  }
  const font = req.method === 'GET' && req.url.match(/^\/fonts\/([\w.-]+\.woff2)$/);
  if (font && fs.existsSync(path.join(DIR, 'fonts', font[1]))) {
    res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
    return fs.createReadStream(path.join(DIR, 'fonts', font[1])).pipe(res);
  }
  res.writeHead(404, CORS); res.end();
}).on('error', e => {
  // уже запущен другой копией: тихо выходим, второй не нужен
  if (e.code === 'EADDRINUSE') { console.log(`Порт ${PORT} уже занят: сервер офиса уже работает.`); process.exit(0); }
  throw e;
}).listen(PORT, '127.0.0.1', () => {
  console.log(`AI-офис слушает http://127.0.0.1:${PORT}`);
});
