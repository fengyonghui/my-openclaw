/**
 * 工具定义生成器
 * 从技能 rawContent 中动态解析参数定义，生成精确的工具 schema
 */

interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  default?: any;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

/**
 * 从技能的 rawContent 中解析前置 YAML 元数据
 */
function parseSkillFrontmatter(rawContent: string): Record<string, any> {
  const frontmatterMatch = rawContent.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return {};
  
  const yaml = frontmatterMatch[1];
  const result: Record<string, any> = {};
  
  // 简单的 YAML 解析
  for (const line of yaml.split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      let value: any = match[2].trim();
      // 移除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * 从技能内容中提取参数定义
 */
function extractParametersFromContent(rawContent: string): Record<string, ToolParameter> {
  const params: Record<string, ToolParameter> = {};
  
  // 匹配参数定义模式
  // 格式1: - `param_name` (type): description
  // 格式2: **param_name** (type): description
  // 格式3: param_name: type - description
  
  const paramPatterns = [
    /[-*]\s+`(\w+)`\s*\((\w+)\):?\s*(.*)/g,
    /\*\*(\w+)\*\*\s*\((\w+)\):?\s*(.*)/g,
    /[-*]\s+(\w+)\s+\((\w+)\):?\s*(.*)/g,
    /^###?\s+(\w+)\s*$/gm,
  ];
  
  // 尝试从 Required Parameters 部分提取
  const requiredSection = rawContent.match(/## Required Parameters([\s\S]*?)(?=##|$)/);
  if (requiredSection) {
    const requiredContent = requiredSection[1];
    // 匹配: write/create requires: {"path": "...", "content": "..."}
    const jsonMatch = requiredContent.match(/"(\w+)":\s*"([^"]+)"/g);
    if (jsonMatch) {
      for (const m of jsonMatch) {
        const [, key, desc] = m.match(/"(\w+)":\s*"([^"]+)"/) || [];
        if (key && desc) {
          params[key] = { type: 'string', description: desc };
        }
      }
    }
  }
  
  return params;
}

/**
 * 内置工具定义（完整版）
 */
export const BUILTIN_TOOL_DEFINITIONS: ToolDefinition[] = [
  // === 文件操作工具 ===
  {
    name: 'list_files',
    description: 'List directory contents in the project workspace. Returns file and folder names with their types.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list. Use "." for current directory, or relative path like "src/components".'
        },
        depth: {
          type: 'number',
          description: 'Depth level for recursive listing (1-10, default 3). Use 1 for flat listing.',
          default: 3
        }
      },
      required: ['path']
    }
  },
  {
    name: 'read_file',
    description: 'Read file content from the project workspace. Supports pagination with offset and limit.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to read (e.g., "src/app.ts", "README.md")'
        },
        offset: {
          type: 'number',
          description: 'Start reading from line N (1-indexed, default 1)',
          default: 1
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read (default 200, max 2000)',
          default: 200
        }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file. MUST include the complete file content. CRITICAL: Use the EXACT file path the user specified in their request. Do NOT invent or add subdirectory prefixes (e.g. "ue/", "ux/", "docs/", "src/") based on assumed conventions — the user will be confused if the file appears somewhere they did not ask for. If unsure about path, ask the user before calling.\n\n⚠️ SIZE LIMIT: If the file content exceeds ~2000 characters, DO NOT write it all at once. Instead:\n1. Use edit_file to create the file skeleton first\n2. Then use edit_file to append content in chunks\n3. Or split into multiple smaller files\nWriting very large content in one call often fails due to response truncation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to write, relative to the project workspace root. Use the EXACT filename/path the user gave — do NOT add directory prefixes on your own initiative (e.g. "ux-test3.txt" not "ue/ux-test3.txt").'
        },
        content: {
          type: 'string',
          description: 'Complete file content. Use \\n for newlines. This parameter is REQUIRED. ⚠️ If content > 2000 chars, use edit_file instead (create skeleton first, then append in chunks).'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Make precise text replacements in an existing file. Finds exact text and replaces it. Use this to append content to files or make incremental changes. Ideal for large files — create the skeleton with write_file, then use edit_file to fill in content.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to edit (e.g., "src/app.ts")'
        },
        oldText: {
          type: 'string',
          description: 'Exact text to find. Must match exactly including whitespace.'
        },
        newText: {
          type: 'string',
          description: 'Text to replace with. Use \\n for newlines.'
        }
      },
      required: ['path', 'oldText', 'newText']
    }
  },
  // === Shell 命令工具 ===
  {
    name: 'shell_exec',
    description: 'Execute shell commands. Use ONLY for build tools (npm, mvn, gradle), git operations, process management, version checks, or when no structured tool exists. For file operations, use read_file/list_files/search_files instead.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute (e.g., "npm run build", "git status", "mvn -v", "java -version")'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default 60, max 300)',
          default: 60
        },
        cwd: {
          type: 'string',
          description: 'Working directory (optional, defaults to project root)'
        }
      },
      required: ['command']
    }
  },
  // === 文件搜索工具 ===
  {
    name: 'search_files',
    description: 'Search for files in the project workspace by name pattern. Use this instead of shell "find" commands. Supports wildcards (*, ?). Returns matching file paths, names, sizes, and modification times.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to search in (e.g., "src", ".", "backend/src")'
        },
        pattern: {
          type: 'string',
          description: 'File name pattern with wildcards (e.g., "*.java", "Foo*", "*Test*"). Use "*" for all files.'
        },
        max_depth: {
          type: 'number',
          description: 'Maximum recursion depth (default 5, max 10)',
          default: 5
        }
      },
      required: ['path', 'pattern']
    }
  },
  // === Agent 委托工具 ===
  {
    name: 'delegate_to_agent',
    description: 'Delegate a task to a team member agent with specific expertise.',
    parameters: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description: 'Name of the team member to delegate to'
        },
        task: {
          type: 'string',
          description: 'Clear and specific task description for the delegate'
        },
        context: {
          type: 'string',
          description: 'Relevant context, requirements, or information the delegate needs'
        }
      },
      required: ['agent_name', 'task']
    }
  }
];

/**
 * 技能专用工具定义映射
 * 为常见技能提供精确的参数定义
 */
export const SKILL_TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // SQL 工具
  'sql-toolkit': {
    name: 'sql_query',
    description: 'Execute SQL queries against configured databases. Returns query results as JSON.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL query to execute (SELECT statements only for safety)'
        },
        database: {
          type: 'string',
          description: 'Database connection name (optional, uses default if not specified)'
        },
        limit: {
          type: 'number',
          description: 'Maximum rows to return (default 100)',
          default: 100
        }
      },
      required: ['query']
    }
  },
  // 数据分析工具
  'data-analysis': {
    name: 'analyze_data',
    description: 'Analyze data and generate insights, charts, or reports.',
    parameters: {
      type: 'object',
      properties: {
        data_source: {
          type: 'string',
          description: 'Path to data file or SQL query result'
        },
        analysis_type: {
          type: 'string',
          enum: ['summary', 'trend', 'correlation', 'comparison', 'distribution'],
          description: 'Type of analysis to perform'
        },
        output_format: {
          type: 'string',
          enum: ['text', 'chart', 'table', 'json'],
          description: 'Output format for results',
          default: 'text'
        }
      },
      required: ['data_source', 'analysis_type']
    }
  },
  // 图表生成工具
  'chart-generator': {
    name: 'generate_chart',
    description: 'Generate charts and visualizations from data.',
    parameters: {
      type: 'object',
      properties: {
        chart_type: {
          type: 'string',
          enum: ['bar', 'line', 'pie', 'scatter', 'table', 'gauge', 'sparkline'],
          description: 'Type of chart to generate'
        },
        data: {
          type: 'string',
          description: 'Data for the chart (JSON or CSV format)'
        },
        title: {
          type: 'string',
          description: 'Chart title'
        },
        options: {
          type: 'string',
          description: 'Additional chart options (JSON format)'
        }
      },
      required: ['chart_type', 'data']
    }
  },
  // Tushare 金融数据
  'tushare': {
    name: 'fetch_stock_data',
    description: 'Fetch Chinese stock and futures market data via Tushare API.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Stock symbol (e.g., "000001.SZ")'
        },
        data_type: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly', 'realtime'],
          description: 'Type of data to fetch'
        },
        start_date: {
          type: 'string',
          description: 'Start date (YYYYMMDD format)'
        },
        end_date: {
          type: 'string',
          description: 'End date (YYYYMMDD format)'
        }
      },
      required: ['symbol', 'data_type']
    }
  },
  // Web 搜索
  'web-search-plus': {
    name: 'web_search',
    description: 'Search the web for information using multiple search engines.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        engine: {
          type: 'string',
          enum: ['google', 'tavily', 'perplexity', 'exa', 'you'],
          description: 'Search engine to use',
          default: 'google'
        },
        max_results: {
          type: 'number',
          description: 'Maximum results to return',
          default: 10
        }
      },
      required: ['query']
    }
  }
};

/**
 * 工具别名映射
 * 支持多种调用方式，提高兼容性
 */
export const TOOL_ALIASES: Record<string, string> = {
  // 文件操作别名
  'list': 'list_files',
  'ls': 'list_files',
  'dir': 'list_files',
  'read': 'read_file',
  'cat': 'read_file',
  'type': 'read_file',
  'write': 'write_file',
  'create': 'write_file',
  'save': 'write_file',
  'edit': 'edit_file',
  'replace': 'edit_file',
  'patch': 'edit_file',
  
  // Shell 别名
  'shell': 'shell_exec',
  'exec': 'shell_exec',
  'cmd': 'shell_exec',
  'run': 'shell_exec',
  'bash': 'shell_exec',
  
  // 委托别名
  'delegate': 'delegate_to_agent',
  'assign': 'delegate_to_agent',
  'task': 'delegate_to_agent'
};

/**
 * 为技能动态生成工具定义
 */
export function generateToolDefinitionForSkill(skill: any): ToolDefinition | null {
  const name = skill.name || skill.id;
  
  // 1. 检查是否有预定义的工具定义
  if (SKILL_TOOL_DEFINITIONS[name]) {
    return SKILL_TOOL_DEFINITIONS[name];
  }
  
  // 2. 从 rawContent 中解析参数
  const rawContent = skill.rawContent || skill.content || '';
  const frontmatter = parseSkillFrontmatter(rawContent);
  const extractedParams = extractParametersFromContent(rawContent);
  
  // 3. 构建工具定义
  const description = frontmatter.description || skill.description || `Execute ${name} skill`;
  
  // 如果没有提取到参数，使用通用参数
  const properties: Record<string, ToolParameter> = Object.keys(extractedParams).length > 0
    ? extractedParams
    : {
        input: { type: 'string', description: 'Input for the skill' },
        options: { type: 'string', description: 'Additional options (JSON format)' }
      };
  
  return {
    name: name,
    description: description,
    parameters: {
      type: 'object',
      properties,
      required: Object.keys(properties).slice(0, 1) // 第一个参数作为必需参数
    }
  };
}

/**
 * 构建完整的工具列表
 * @param project 项目配置
 * @param allProjectAgents 项目 Agent 列表
 * @param coordinatorAgentId 协调 Agent ID
 * @param enabledSkills 启用的技能列表
 */
export function buildToolList(
  project: any,
  allProjectAgents: any[],
  coordinatorAgentId: string | undefined,
  enabledSkills: any[]
): any[] {
  const tools: any[] = [];
  const addedToolNames = new Set<string>();
  
  // 1. 添加内置文件工具（如果启用）
  if (project?.enabledSkillIds?.includes('builtin-file-io')) {
    for (const def of BUILTIN_TOOL_DEFINITIONS) {
      if (['list_files', 'read_file', 'write_file', 'edit_file', 'search_files'].includes(def.name)) {
        tools.push({ type: 'function', function: def });
        addedToolNames.add(def.name);
      }
    }
  }
  
  // 2. 添加 Shell 工具（如果启用）
  if (project?.enabledSkillIds?.includes('builtin-shell-cmd')) {
    const shellDef = BUILTIN_TOOL_DEFINITIONS.find(d => d.name === 'shell_exec');
    if (shellDef) {
      tools.push({ type: 'function', function: shellDef });
      addedToolNames.add(shellDef.name);
      // 同时添加 shell-cmd 别名以保持兼容性
      tools.push({
        type: 'function',
        function: {
          name: 'shell-cmd',
          description: 'Execute shell commands. Alias for shell_exec.',
          parameters: shellDef.parameters
        }
      });
      addedToolNames.add('shell-cmd');
    }
  }
  
  // 3. 添加委托工具（如果有团队成员）
  const delegateOptions = allProjectAgents
    .filter((a: any) => String(a.id) !== String(coordinatorAgentId))
    .map(a => a.name);
  
  if (delegateOptions.length > 0) {
    const delegateDef = BUILTIN_TOOL_DEFINITIONS.find(d => d.name === 'delegate_to_agent');
    if (delegateDef) {
      // 添加可用 Agent 列表到描述
      const enhancedDef = {
        ...delegateDef,
        parameters: {
          ...delegateDef.parameters,
          properties: {
            ...delegateDef.parameters.properties,
            agent_name: {
              ...delegateDef.parameters.properties.agent_name,
              description: `Name of the team member. Available: ${delegateOptions.join(', ')}`
            }
          }
        }
      };
      tools.push({ type: 'function', function: enhancedDef });
      addedToolNames.add('delegate_to_agent');
    }
  }
  
  // 4. 添加技能工具
  for (const skill of enabledSkills) {
    const skillName = skill.name || skill.id;
    
    // 跳过已添加的内置技能
    if (skillName.startsWith('builtin-') || addedToolNames.has(skillName)) {
      continue;
    }
    
    const def = generateToolDefinitionForSkill(skill);
    if (def) {
      tools.push({ type: 'function', function: def });
      addedToolNames.add(def.name);
    }
  }
  
  return tools;
}

/**
 * 解析工具调用，处理别名
 */
export function resolveToolName(toolName: string): string {
  return TOOL_ALIASES[toolName.toLowerCase()] || toolName;
}

/**
 * 验证工具调用参数
 */
export function validateToolCall(toolName: string, args: Record<string, any>): { valid: boolean; error?: string } {
  const resolvedName = resolveToolName(toolName);
  const def = BUILTIN_TOOL_DEFINITIONS.find(d => d.name === resolvedName) ||
              Object.values(SKILL_TOOL_DEFINITIONS).find(d => d.name === resolvedName);
  
  if (!def) {
    return { valid: true }; // 未知工具，跳过验证
  }
  
  const required = def.parameters.required || [];
  const missing = required.filter(param => !(param in args) || args[param] === undefined || args[param] === '');
  
  if (missing.length > 0) {
    return {
      valid: false,
      error: `Missing required parameter(s): ${missing.join(', ')}. ` +
             `Tool "${resolvedName}" requires: ${required.join(', ')}`
    };
  }
  
  return { valid: true };
}
