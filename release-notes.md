## Release v0.3.33

### ✨ Features
- **三层记忆系统优化** — 缓存修复、会话记忆注入、单一数据源、晋升机制
- **增强团队委派与协调机制** — 结构化能力摘要、角色工具集、质量评估
- **新增 search_files 工具** — 引导 LLM 使用结构化工具替代 shell 命令

### 🔧 Fixes (Windows Shell 命令转换全面改进)
- **统一 Windows shell 命令执行管线** — 消除 isPowerShellCmd 路由分支
- **shell_exec 多项修复** — findstr /S 递归搜索、路径斜杠、&& 分隔符、-Raw/-Encoding 参数剥离、嵌套 PowerShell 等
- **grep/ls/type/find 命令转换** — 多文件路径、regex flags、composite commands、pipe head/tail、find -maxdepth -o 等
- **JSON 处理** — unterminated-string recovery、write_file 截断恢复、size limits
- **其他** — maxBuffer overflow handler、CLIXML error cleanup、2>/dev/null 剥离、platform rules 等

### 📊 Summary
- **41** commits since v0.3.32
- Focus: Windows shell compatibility, memory system, team delegation
