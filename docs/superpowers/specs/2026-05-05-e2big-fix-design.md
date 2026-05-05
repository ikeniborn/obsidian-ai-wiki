# Fix: E2BIG при spawn в claude-cli-client

**Дата:** 2026-05-05  
**Статус:** approved

## Проблема

При выполнении `lint` (особенно фаза `buildFixMessages`) возникает ошибка:
```json
{"kind":"error","message":"Error: spawn E2BIG"}
```

`E2BIG` — системная ошибка POSIX "Argument list too long". Ядро Linux отклоняет `execve()`, когда суммарный размер `argv[]` + env превышает `ARG_MAX` (~2 MB).

**Источник:** `claude-cli-client.ts` передаёт `userText` (контент wiki-страниц) и `systemContent` (системный промпт) как CLI-аргументы:
```typescript
args.push("--", "-p", userText, ...)          // userText может быть > 1 MB
if (systemContent) args.push("--system-prompt", systemContent)
```

В `buildFixMessages` контент страниц передаётся **без truncate** (`c` вместо `c.slice(0, N)`), что для большого домена (100+ страниц) легко превышает лимит.

## Ограничения Claude Code CLI

Проверено по официальной документации:

| Поведение | Факт |
|---|---|
| `claude -p "prompt"` | Обязателен для non-interactive режима |
| Без `-p` | Claude запускает интерактивную сессию — **не работает** |
| `-p -` (stdin как промпт) | **Не поддерживается** |
| `--system-prompt-file /path` | ✅ Поддерживается |
| `--append-system-prompt-file /path` | ✅ Поддерживается |
| `cat file \| claude -p "query"` | stdin — дополнительный контекст рядом с `-p` |

## Решение

### Стратегия

Если `userText` или `systemContent` превышают порог **32 768 байт (32 KB)**:
- Записать во временный файл в папке плагина (`<plugin>/tmp/`)
- Передать через `--system-prompt-file` / `--append-system-prompt-file`
- Использовать `-p "."` как минимальный dummy для активации non-interactive режима

Семантический компромисс: `userText` попадает в system-уровень через `--append-system-prompt-file`. Для use-case lint/fix wiki-страниц это приемлемо — Claude видит весь контент.

### Расположение temp-файлов

```
<vault>/.obsidian/plugins/obsidian-llm-wiki/tmp/
  llm-wiki-usr-1746123456-a3f7.txt   ← большой userText
  llm-wiki-sys-1746123456-b8e2.txt   ← большой systemContent
```

Каталог создаётся при первом использовании (`mkdirSync(tmpDir, { recursive: true })`).  
Файлы удаляются в `finally`-блоке `_generate()`.

## Изменяемые файлы

| Файл | Что меняется |
|---|---|
| `src/claude-cli-client.ts` | Новые импорты `node:fs` + `node:path`, логика temp-файлов, новое поле `tmpDir` в конфиге |
| `src/controller.ts` | Вычисление `tmpDir`, передача в `ClaudeCliClient` |

## Детали реализации

### Новые импорты в `claude-cli-client.ts`

```typescript
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
```

### `ClaudeCliConfig` (claude-cli-client.ts)

```typescript
export interface ClaudeCliConfig {
  iclaudePath: string;
  model: string;
  requestTimeoutSec: number;
  cwd?: string;
  allowedTools?: string;
  tmpDir: string;  // ← добавляется
}
```

### Логика в `_create()` (claude-cli-client.ts)

Temp-файлы создаются здесь и передаются в `_generate()` / `_collect()` для последующей очистки.

Все операции с файлами обёрнуты в try/catch — если что-то упало на полпути, уже созданные файлы удаляются до выброса ошибки (иначе при частичном сбое первый файл оставался бы навсегда).

```typescript
const LARGE_THRESHOLD = 32_768; // 32 KB — консервативный порог; типичный lint > 100 KB
const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const tmpFiles: string[] = [];  // пути temp-файлов → передаются в _generate для cleanup

const args: string[] = [];
if (model) args.push("--model", model);  // iclaude.sh флаги

args.push("--");  // разделитель — всё после идёт в claude

try {
  // userText: большой → temp + --append-system-prompt-file + dummy -p
  const isLargeUser = Buffer.byteLength(userText, "utf8") > LARGE_THRESHOLD;
  if (isLargeUser) {
    mkdirSync(this.cfg.tmpDir, { recursive: true });
    const tmpUsrFile = join(this.cfg.tmpDir, `llm-wiki-usr-${id}.txt`);
    writeFileSync(tmpUsrFile, userText, "utf-8");
    tmpFiles.push(tmpUsrFile);
    args.push("-p", ".");
    args.push("--append-system-prompt-file", tmpUsrFile);
  } else {
    args.push("-p", userText);
  }

  args.push("--output-format", "stream-json", "--verbose");
  args.push("--disable-slash-commands");
  args.push("--dangerously-skip-permissions");

  if (this.cfg.allowedTools) args.push("--tools", this.cfg.allowedTools);

  // systemContent: большой → temp + --system-prompt-file
  if (systemContent) {
    const isLargeSys = Buffer.byteLength(systemContent, "utf8") > LARGE_THRESHOLD;
    if (isLargeSys) {
      mkdirSync(this.cfg.tmpDir, { recursive: true });
      const tmpSysFile = join(this.cfg.tmpDir, `llm-wiki-sys-${id}.txt`);
      writeFileSync(tmpSysFile, systemContent, "utf-8");
      tmpFiles.push(tmpSysFile);
      args.push("--system-prompt-file", tmpSysFile);
    } else {
      args.push("--system-prompt", systemContent);
    }
  }
} catch (err) {
  // очищаем уже созданные файлы перед проброской ошибки
  for (const f of tmpFiles) { try { unlinkSync(f); } catch { /* ignore */ } }
  throw err;
}

// tmpFiles передаётся дальше для очистки в _generate / _collect
if ((params as { stream?: boolean }).stream) {
  return Promise.resolve(this._makeIterable(args, opts?.signal, requestTimeoutSec, tmpFiles));
}
return this._collect(args, opts?.signal, requestTimeoutSec, tmpFiles);
```

### Сигнатуры `_makeIterable`, `_collect`, `_generate`

```typescript
private _makeIterable(args, signal, timeoutSec, tmpFiles: string[]): AsyncIterable<...>
private async _collect(args, signal, timeoutSec, tmpFiles: string[]): Promise<...>
private async *_generate(args, signal, timeoutSec, tmpFiles: string[]): AsyncGenerator<...>
```

### `stdio` не меняется

```typescript
spawn(this.cfg.iclaudePath, args, {
  stdio: ["ignore", "pipe", "pipe"],  // без изменений
  cwd: this.cfg.cwd || undefined,
})
```

### Очистка в `finally` (внутри `_generate()`)

```typescript
} finally {
  clearTimeout(timeoutHandle);
  signal?.removeEventListener("abort", onAbort);
  rl.close();
  for (const f of tmpFiles) { try { unlinkSync(f); } catch { /* already gone */ } }
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
  }
}
```

### Вычисление `tmpDir` в `controller.ts` (`buildAgentRunner`)

```typescript
// manifest.dir = ".obsidian/plugins/obsidian-llm-wiki" (vault-relative, optional)
const manifestDir = this.plugin.manifest.dir
  ?? join(this.app.vault.configDir, "plugins", this.plugin.manifest.id);
const pluginDir = (this.app.vault.adapter as { getFullPath: (p: string) => string })
  .getFullPath(manifestDir);
const tmpDir = join(pluginDir, "tmp");

const llm = s.backend === "claude-agent"
  ? new ClaudeCliClient({
      ...s.claudeAgent,
      requestTimeoutSec: maxTimeoutSec,
      cwd: s.claudeAgent.spawnCwd || "/tmp",
      tmpDir,  // ← добавляется
    })
  : new OpenAI({ ... });
```

## Обработка ошибок

| Сценарий | Поведение |
|---|---|
| `mkdirSync` / `writeFileSync` падает на первом файле | Ошибка пробрасывается, spawn не вызывается |
| `writeFileSync` падает на втором файле (первый уже создан) | catch-блок в `_create()` удаляет первый файл, затем пробрасывает ошибку |
| `unlinkSync` падает (файл уже удалён) | Игнорируется (try/catch) |
| Процесс завершился аварийно до `finally` | `finally` в `_generate()` гарантирует очистку оставшихся файлов |

## Тестирование

- Существующие тесты (`stream.test.ts`, `prompt.test.ts`, `settings.test.ts`) не затрагиваются.
- Добавить сценарий в `tests/runner.integration.test.ts`: `userText` > 32 KB → spawn не падает, mock-iclaude.sh получает корректный вывод.
- Вручную: запустить lint на домене с 50+ страницами, убедиться что E2BIG не воспроизводится.
