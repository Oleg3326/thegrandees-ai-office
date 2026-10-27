// Дописывает хуки AI-офиса:
//   Claude Code → %USERPROFILE%\.claude\settings.json
//   Codex       → %USERPROFILE%\.codex\hooks.json (только если Codex установлен)
// Перед изменением делает копию файла *.bak-<время>. Чужие хуки не трогает. Повторный запуск ничего не дублирует.
// Удалить: node install-hooks.mjs --remove
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hookPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook.mjs').replace(/\\/g, '/');
const remove = process.argv.includes('--remove');
// Полный путь к node, которым запущен установщик: хуки работают, даже если node нет в PATH.
const nodePath = process.execPath.replace(/\\/g, '/');

const isOurs = h => {
  const parts = [h?.command, h?.commandWindows, ...(Array.isArray(h?.args) ? h.args : [])].map(String);
  return h?.type === 'command' && parts.some(x => x.includes(hookPath) || (x.includes('hook.mjs') && /AI[- ]Office/.test(x)));
};

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  try { return text.trim() ? JSON.parse(text) : {}; }
  catch { console.error(`Не смог прочитать ${file}: там ошибка в JSON. Этот файл не менял.`); return null; }
}

function install(file, events, makeGroup) {
  const settings = readJson(file);
  if (!settings) return false;
  const before = JSON.stringify(settings);
  settings.hooks ??= {};
  for (const ev of events) {
    const groups = (settings.hooks[ev] ?? [])
      .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isOurs(h)) }))
      .filter(g => g.hooks.length > 0);
    if (!remove) groups.push(makeGroup(ev));
    if (groups.length) settings.hooks[ev] = groups; else delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  if (JSON.stringify(settings) === before) { console.log(`Хуки в ${file} уже на месте`); return true; }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${Date.now()}`);
  else fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  console.log(`${remove ? 'Убрал хуки из' : 'Записал хуки в'} ${file}`);
  return true;
}

// Claude Code: запуск напрямую (node + аргументы), без оболочки.
// SubagentStart/SubagentStop/PostToolUseFailure добавлены в форке: субагенты как отдельные боты и красные глаза при ошибке.
const claudeEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'Notification', 'Stop', 'SessionEnd'];
install(path.join(os.homedir(), '.claude', 'settings.json'), claudeEvents, ev => {
  const g = { hooks: [{ type: 'command', command: nodePath, args: [hookPath, 'claude'], timeout: 3 }] };
  if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(ev)) g.matcher = '*';
  return g;
});

// Codex: команда строкой. Его хуки нужно один раз одобрить в Codex командой /hooks.
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
if (fs.existsSync(codexHome)) {
  const codexEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd'];
  const cmd = `"${nodePath}" "${hookPath}" codex`;
  install(path.join(codexHome, 'hooks.json'), codexEvents, () => ({ hooks: [{ type: 'command', command: cmd, commandWindows: cmd, timeout: 3 }] }));
  if (!remove) console.log('Codex: открой Codex, набери /hooks и одобри (trust) хуки AI-Office. Без этого Codex их не запускает.');
} else {
  console.log('Codex не найден (нет папки .codex), его хуки пропускаю.');
}
