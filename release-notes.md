## Release v0.3.34

### ⚡ Performance
- **db.json 瘦身 125MB → 0.36MB（-99.7%）** — 会话正文不再在 db.json 里存全文副本
  - db.json 只保留会话元数据索引（id/title/时间戳/消息数），正文以项目文件为唯一真相源
  - `DbService.load()` 从 ~660ms 降到 ~10ms；`save()` 不再每次重写 125MB
  - 孤儿例外：项目 workspace 已删除的会话正文只此一份，仍保留全文防丢
- **tool 结果存储侧截断（8000 字符）** — 单条 2.4MB 的 shell 输出不再撑爆会话文件
  - 截断时包 JSON envelope，保证 tool result 仍是合法 JSON（MiniMax 严格校验）

### 🔧 Fixes
- **新建项目的会话消失 + LLM 收不到用户问题** — DbService 的 workspace 索引只在进程启动时构建一次，
  服务启动后新建的项目永远不在索引里，导致会话列表为空且 user 消息被静默丢弃
- **附件 base64 超 1MB 被 fastify 打回 413** — bodyLimit 提至 50MB，
  前端 fetch 非 2xx 时把错误写进 assistant 消息（不再静默空白）
- **LLM 看不到附件内容** — 附件解析结果改为 parsedAttachments 独立字段，仅在 LLM 请求边界合并
- **transformMessage JSON 还原误伤 user 消息** — 只对 role=tool 做 JSON 还原
- **/resend 只截断不触发 LLM** — 补全流式响应链路
- **edit_file 死循环耗尽 Token** — 连续无变化时直接终止模型循环
- **孤儿 tool_call 触发 2013 错误** — slidingWindow 裁剪后二次过滤孤儿 tool_call/tool_result
- **shell_exec self-kill** — taskkill / Stop-Process / pkill 误杀自身进程
- **PowerShell 命令转换** — cd 改 Set-Location、管道组合对象误报 exit code 1、unwrap 截断含分号命令

### ✨ Features
- **启动时数据同步服务** — 自动从项目目录导入会话，修复 DB_PATH 解析
- **新建项目默认启用 3 个 builtin 技能**（file-io / shell-cmd / inline-python-edit）
- **MiniMax-M3 tool_call 格式解析** + ChatDetailPage 加载状态
- **补充 /api/v1/chats/:id/status 端点** + 前端轮询兜底
- **release 包附 README 与一键启动脚本**（Windows CMD / PowerShell / Linux）

### 🧪 Testing
- 新增 `backend/scripts/regress-phase6.mjs` — 14 项端到端回归（覆盖新建项目、
  LLM 收发消息、附件上传、db.json 瘦身）
- 新增 `backend/scripts/test-tool-truncation-unit.mjs` — 10 项截断单元测试
  （重点验证截断后 JSON 结构不被破坏）

### 📊 Summary
- **71** commits since v0.3.33
- Focus: storage architecture, LLM context integrity, Windows shell compatibility
