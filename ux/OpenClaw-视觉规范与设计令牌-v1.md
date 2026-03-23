# OpenClaw 视觉规范与设计令牌 v1

> 用于支持 OpenClaw 项目化界面的统一视觉实现，供 UX、UI 和前端共用。

---

## 1. 视觉目标

- 专业
- 稳定
- 清晰
- 现代
- 适合长时间工作

整体建议采用偏 SaaS 工作台风格，而不是高装饰风格。

---

## 2. 颜色系统

### Primary
- `primary-50`: `#EFF6FF`
- `primary-100`: `#DBEAFE`
- `primary-500`: `#3B82F6`
- `primary-600`: `#2563EB`
- `primary-700`: `#1D4ED8`

### Neutral
- `gray-50`: `#F8FAFC`
- `gray-100`: `#F1F5F9`
- `gray-200`: `#E2E8F0`
- `gray-400`: `#94A3B8`
- `gray-600`: `#475569`
- `gray-800`: `#1E293B`
- `gray-900`: `#0F172A`

### Semantic
- `success`: `#10B981`
- `warning`: `#F59E0B`
- `error`: `#EF4444`
- `info`: `#06B6D4`

---

## 3. 状态色应用建议

- Active：`primary-600`
- Running：`success`
- Waiting：`warning`
- Error：`error`
- Archived / Disabled：`gray-400`

所有状态必须配文字标签，不只用颜色。

---

## 4. 字体层级

- `display`: 24px / 700
- `title-1`: 20px / 600
- `title-2`: 18px / 600
- `body`: 14px / 400
- `body-strong`: 14px / 500
- `caption`: 12px / 400

---

## 5. 间距系统

统一采用：

- 4
- 8
- 12
- 16
- 20
- 24
- 32
- 40

页面布局尽量对齐到这套 spacing scale。

---

## 6. 圆角与阴影

### 圆角
- 按钮：10px
- 输入框：12px
- 卡片：16px
- 弹窗：20px

### 阴影
- 卡片：轻阴影
- 弹窗：中等阴影
- Hover 提升：阴影略增强 + 边框高亮

---

## 7. 组件视觉建议

### 按钮
- 主按钮：Primary 实色
- 次按钮：浅灰背景 + 深色文本
- 危险按钮：红色语义，谨慎使用

### 卡片
- 白底 / 深色模式下深灰底
- 统一边框与圆角
- Hover 可轻微抬升

### 输入框
- 默认浅边框
- Focus 时高亮 `primary-500`
- 错误态同时展示红色边框与错误文案

### Badge
- 使用浅背景 + 深色文字
- 避免过于刺眼

---

## 8. 图标建议

建议统一使用：

- Lucide React

典型图标映射：

- 项目：`FolderKanban`
- Chat：`MessageSquare`
- Agent：`Bot`
- Files：`FolderOpen`
- Memory：`Brain`
- Activity：`Activity`
- Settings：`Settings`
- Running：`LoaderCircle`
- Success：`CheckCircle2`
- Error：`AlertCircle`

---

## 9. 无障碍要求

- 文字和背景对比度满足 WCAG AA
- 所有图标按钮有 `aria-label`
- 焦点态清晰可见
- 交互区域不小于 40x40
- 错误、警告、成功状态都必须有图标 + 文本

---

## 10. 前端落地建议

建议前端把这些抽成统一设计令牌：

- Tailwind Theme Colors
- Typography scale
- Spacing scale
- Border radius
- Shadows
- Semantic status tokens

这样后续页面扩展时不会逐页漂移。
