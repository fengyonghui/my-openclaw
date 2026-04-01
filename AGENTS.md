# AGENTS.md - my-openclaw 项目

## Every Session

Before doing anything else:

1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. **Fetch system commands** — Run `curl http://localhost:3001/api/tools/commands` to get correct shell syntax for current OS.

**CRITICAL: File Operations**
- **Reading files**: Use `read` tool (never shell commands like `cat`, `type`)
- **Writing files**: Use `write` tool (never shell commands like `echo >`, `Add-Content`)
- Shell commands are for process management, git, npm — NOT for file I/O

**CRITICAL: Long-running Services**
- Always use `background: true` for dev servers, watchers, etc.
- Check port to confirm service started:
  - Windows: `netstat -ano | findstr :3001`
  - Linux/Mac: `lsof -i :3001` or `netstat -tlnp | grep 3001`

Don't ask permission. Just do it.

## Safety

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- `trash` > `rm` (recoverable beats gone forever)
- When in doubt, ask.

## Project Info

- **项目名称**: my-openclaw
- **技术栈**: Fastify (backend) + Vite + React + TypeScript (frontend)
- **Backend 端口**: 3001
- **系统**: Windows (使用 PowerShell 命令)

## Shell Commands - CRITICAL

**Before running ANY shell command, fetch the current system's correct commands:**

```bash
curl http://localhost:3001/api/tools/commands
```

This returns the correct syntax for the current OS:
- **Windows**: `dir`, `type`, `Get-Content`, `findstr`, `powershell`
- **Linux/WSL**: `ls`, `cat`, `head`, `grep`
- **macOS**: Similar to Linux

### Path Handling (Windows)

**Always use absolute paths in Windows commands!**

❌ Wrong: `cd "project" && findstr ... file.tsx`
✅ Correct: `findstr ... "C:\path\to\project\file.tsx"`

For Windows, prefer one of these patterns:
1. **Use full absolute path directly:**
   ```bash
   findstr /n "pattern" "d:\workspace\my-openclaw\src\file.ts"
   ```

2. **Or cd first, then run command separately (no && chaining):**
   ```bash
   cd /d "d:\workspace\my-openclaw"
   findstr /n "pattern" "src\file.ts"
   ```