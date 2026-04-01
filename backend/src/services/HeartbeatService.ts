import { DbService } from './DbService.js';
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export interface HeartbeatConfig {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  cronExpression?: string;       // Cron 表达式，如 "*/30 * * * *"
  intervalMinutes?: number;      // 简单间隔模式（分钟）
  prompt: string;                // 心跳执行的 prompt
  enabled: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface HeartbeatResult {
  success: boolean;
  message: string;
  output?: string;
  error?: string;
  executedAt: string;
  duration?: number;
}

interface RunningJob {
  timer: NodeJS.Timeout | null;
  running: boolean;
  lastRun?: string;
  nextRun?: string;
  lastResult?: HeartbeatResult;
}

// 内部状态：每个项目的运行任务
const runningJobs = new Map<string, RunningJob>();
const eventEmitter = new EventEmitter();

// 解析 cron 表达式（简化版，支持标准格式）
function parseCron(cronExpr: string): { nextRun: Date } | null {
  try {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 5) return null;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const now = new Date();
    const next = new Date(now);

    // 设置秒为 0
    next.setSeconds(0);
    next.setMilliseconds(0);

    // 分钟
    if (minute === '*') {
      next.setMinutes(next.getMinutes() + 1);
    } else if (minute.includes('/')) {
      const step = parseInt(minute.split('/')[1]);
      next.setMinutes(next.getMinutes() + step);
    } else {
      next.setMinutes(parseInt(minute));
      if (next.getTime() <= now.getTime()) {
        next.setHours(next.getHours() + 1);
      }
    }

    // 小时
    if (hour !== '*') {
      next.setHours(parseInt(hour));
    }

    // 日
    if (dayOfMonth !== '*') {
      next.setDate(parseInt(dayOfMonth));
    }

    // 月
    if (month !== '*') {
      next.setMonth(parseInt(month) - 1);
    }

    // 星期
    if (dayOfWeek !== '*') {
      const targetDay = parseInt(dayOfWeek);
      const currentDay = next.getDay();
      const diff = (targetDay - currentDay + 7) % 7;
      next.setDate(next.getDate() + diff);
    }

    // 如果计算出的时间已过，推进到下一个周期
    if (next.getTime() <= now.getTime()) {
      next.setHours(next.getHours() + 1);
    }

    return { nextRun: next };
  } catch {
    return null;
  }
}

// 简单的 cron 解析：检测是否是 */N 或纯数字
function parseSimpleCron(cronExpr: string, now: Date): Date | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const [minute] = parts;
  
  if (minute.startsWith('*/')) {
    const step = parseInt(minute.substring(2));
    if (isNaN(step) || step < 1) return null;
    const nextMinute = Math.ceil(now.getMinutes() / step) * step;
    const next = new Date(now);
    next.setSeconds(0);
    next.setMilliseconds(0);
    if (nextMinute >= 60) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(nextMinute % 60);
    } else {
      next.setMinutes(nextMinute);
    }
    return next;
  }
  
  return null;
}

// 计算下一次执行时间
function getNextRunTime(config: HeartbeatConfig): string {
  const now = new Date();
  
  if (config.intervalMinutes && config.intervalMinutes > 0) {
    const next = new Date(now.getTime() + config.intervalMinutes * 60 * 1000);
    return next.toISOString();
  }
  
  if (config.cronExpression) {
    // 尝试简化解析
    const simple = parseSimpleCron(config.cronExpression, now);
    if (simple) {
      return simple.toISOString();
    }
    
    // 尝试完整 cron 解析
    const parsed = parseCron(config.cronExpression);
    if (parsed) {
      return parsed.nextRun.toISOString();
    }
    
    // 默认：每 30 分钟
    const next = new Date(now.getTime() + 30 * 60 * 1000);
    return next.toISOString();
  }
  
  // 默认：每 30 分钟
  const next = new Date(now.getTime() + 30 * 60 * 1000);
  return next.toISOString();
}

// 路径转换（与 chats.ts 保持一致）
async function convertPath(workspacePath: string): Promise<string> {
  const os = await import('os');
  const isWindows = os.platform() === 'win32';
  
  let converted = workspacePath;
  
  if (isWindows) {
    if (/^\/mnt\/[a-z]\//i.test(converted)) {
      const match = converted.match(/^\/mnt\/([a-z])\/(.+)$/i);
      if (match) {
        const drive = match[1].toUpperCase();
        const restPath = match[2].replace(/\//g, '\\');
        converted = `${drive}:\\${restPath}`;
      }
    }
  } else {
    if (/^[A-Z]:/i.test(converted)) {
      const driveLetter = converted.charAt(0).toLowerCase();
      const remainingPath = converted.slice(2).replace(/\\/g, '/');
      converted = `/mnt/${driveLetter}${remainingPath}`;
    } else if (!converted.startsWith('/mnt/')) {
      converted = converted.replace(/\\/g, '/');
    }
  }
  
  return converted;
}

// 加载 MEMORY.md
async function loadMemoryFile(workspacePath: string): Promise<string> {
  const fsPromises = fs.promises;
  
  let memoryPath = await convertPath(workspacePath);
  memoryPath = path.join(memoryPath, 'MEMORY.md');
  
  try {
    if (fs.existsSync(memoryPath)) {
      return await fsPromises.readFile(memoryPath, 'utf-8');
    }
  } catch (e) {
    console.log(`[Heartbeat] Could not load MEMORY.md: ${(e as Error).message}`);
  }
  
  return '';
}

// 加载 HEARTBEAT.md
async function loadHeartbeatFile(workspacePath: string): Promise<string> {
  const fsPromises = fs.promises;
  
  let hbPath = await convertPath(workspacePath);
  hbPath = path.join(hbPath, 'HEARTBEAT.md');
  
  try {
    if (fs.existsSync(hbPath)) {
      return await fsPromises.readFile(hbPath, 'utf-8');
    }
  } catch (e) {
    console.log(`[Heartbeat] Could not load HEARTBEAT.md: ${(e as Error).message}`);
  }
  
  return '';
}

// 执行心跳
async function executeHeartbeat(config: HeartbeatConfig): Promise<HeartbeatResult> {
  const startTime = Date.now();
  
  try {
    // 1. 获取项目信息
    const project = await DbService.getProject(config.projectId);
    if (!project) {
      return {
        success: false,
        message: '项目不存在',
        error: `Project ${config.projectId} not found`,
        executedAt: new Date().toISOString(),
        duration: Date.now() - startTime
      };
    }
    
    // 2. 获取协调 Agent
    const coordinatorAgentId = project.coordinatorAgentId || project.defaultAgentId || '1';
    const allModels = await DbService.getModels();
    const defaultModel = allModels[0];
    
    if (!defaultModel) {
      return {
        success: false,
        message: '系统中未配置任何模型',
        error: 'No model configured',
        executedAt: new Date().toISOString(),
        duration: Date.now() - startTime
      };
    }
    
    // 3. 构建系统消息
    const memoryContent = await loadMemoryFile(project.workspace);
    const heartbeatContent = await loadHeartbeatFile(project.workspace);
    
    // 4. 构建 prompt
    let userPrompt = config.prompt;
    
    // 如果 HEARTBEAT.md 存在，追加到 prompt
    if (heartbeatContent) {
      userPrompt = `请严格遵循 HEARTBEAT.md 中的指示执行心跳检查：\n\n${heartbeatContent}\n\n---\n\n你的心跳任务：\n${config.prompt}`;
    }
    
    const systemMessage = {
      role: 'system',
      content: `You are an AI assistant performing a heartbeat check for project: **${project.name}**\n` +
        `Workspace: **${project.workspace}**\n\n` +
        (memoryContent ? `## PROJECT MEMORY\n${memoryContent}\n\n` : '') +
        `## HEARTBEAT INSTRUCTIONS\n` +
        `You are running a scheduled heartbeat check. Be efficient and concise.\n` +
        `Check if there are any urgent tasks, reminders, or important updates.\n` +
        `If there is nothing to report, just respond "HEARTBEAT_OK".\n` +
        `If you need to alert the user, provide a brief summary of what needs attention.\n\n` +
        `## OUTPUT FORMAT\n` +
        `- If nothing needs attention: reply "HEARTBEAT_OK"\n` +
        `- If something needs attention: provide a brief summary (1-3 sentences)\n` +
        `- DO NOT write any files unless explicitly instructed\n` +
        `- DO NOT make any changes unless explicitly instructed\n` +
        `- Focus on READ-ONLY operations: check files, read logs, review status`
    };
    
    const messages = [
      systemMessage,
      { role: 'user', content: userPrompt }
    ];
    
    // 5. 调用模型
    const apiUrl = `${defaultModel.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${defaultModel.apiKey}`
      },
      body: JSON.stringify({
        model: defaultModel.modelId,
        messages,
        temperature: 0.7,
        max_tokens: 500  // 心跳只返回简短响应
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false,
        message: `API 调用失败`,
        error: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
        executedAt: new Date().toISOString(),
        duration: Date.now() - startTime
      };
    }
    
    const data: any = await response.json();
    const output = data.choices?.[0]?.message?.content || '';
    
    // 6. 判断是否需要通知用户
    const needsAttention = output.trim() !== 'HEARTBEAT_OK' && output.trim() !== '';
    
    // 7. 发送通知（如果需要）
    if (needsAttention) {
      // 发送事件通知（前端可以订阅）
      eventEmitter.emit('heartbeat:alert', {
        projectId: config.projectId,
        heartbeatId: config.id,
        heartbeatName: config.name,
        message: output,
        timestamp: new Date().toISOString()
      });
      
      // 如果项目有配置的通知方式，可以在这里扩展
      console.log(`[Heartbeat Alert] ${config.name}: ${output.slice(0, 100)}`);
    }
    
    return {
      success: true,
      message: needsAttention ? '发现需要关注的事项' : '检查完成，无异常',
      output: output,
      executedAt: new Date().toISOString(),
      duration: Date.now() - startTime
    };
    
  } catch (error: any) {
    return {
      success: false,
      message: `执行失败: ${error.message}`,
      error: error.message,
      executedAt: new Date().toISOString(),
      duration: Date.now() - startTime
    };
  }
}

// 保存执行结果到历史记录
async function saveToHistory(config: HeartbeatConfig, result: HeartbeatResult) {
  const db = await DbService.load();
  
  if (!db.heartbeatHistory) {
    db.heartbeatHistory = [];
  }
  
  // 添加历史记录
  db.heartbeatHistory.unshift({
    id: `hb_history_${Date.now()}`,
    heartbeatId: config.id,
    projectId: config.projectId,
    heartbeatName: config.name,
    success: result.success,
    message: result.message,
    output: result.output || '',
    executedAt: result.executedAt,
    duration: result.duration
  });
  
  // 只保留最近 500 条历史
  if (db.heartbeatHistory.length > 500) {
    db.heartbeatHistory = db.heartbeatHistory.slice(0, 500);
  }
  
  await DbService.save();
}

export class HeartbeatService extends EventEmitter {
  
  // 启动某个项目的心跳调度
  static async startForProject(projectId: string) {
    // 清除现有调度
    this.stopForProject(projectId);
    
    // 获取项目的所有心跳配置
    const heartbeats = await DbService.getProjectHeartbeats(projectId);
    const enabledHeartbeats = heartbeats.filter(h => h.enabled);
    
    if (enabledHeartbeats.length === 0) {
      console.log(`[Heartbeat] No enabled heartbeats for project ${projectId}`);
      return;
    }
    
    const job: RunningJob = {
      timer: null,
      running: true
    };
    runningJobs.set(projectId, job);
    
    console.log(`[Heartbeat] Starting ${enabledHeartbeats.length} heartbeat(s) for project ${projectId}`);
    
    // 为每个心跳设置调度
    for (const config of enabledHeartbeats) {
      scheduleHeartbeat(projectId, config);
    }
  }
  
  // 停止某个项目的所有心跳
  static stopForProject(projectId: string) {
    const job = runningJobs.get(projectId);
    if (job?.timer) {
      clearInterval(job.timer);
      job.timer = null;
    }
    runningJobs.delete(projectId);
    console.log(`[Heartbeat] Stopped heartbeats for project ${projectId}`);
  }
  
  // 停止所有心跳
  static stopAll() {
    for (const projectId of runningJobs.keys()) {
      this.stopForProject(projectId);
    }
    console.log(`[Heartbeat] All heartbeats stopped`);
  }
  
  // 手动触发一次心跳
  static async triggerHeartbeat(heartbeatId: string): Promise<HeartbeatResult> {
    const db = await DbService.load();
    const heartbeat = db.heartbeats?.find((h: any) => h.id === heartbeatId);
    
    if (!heartbeat) {
      return {
        success: false,
        message: '心跳配置不存在',
        error: `Heartbeat ${heartbeatId} not found`,
        executedAt: new Date().toISOString()
      };
    }
    
    console.log(`[Heartbeat] Manual trigger: ${heartbeat.name}`);
    
    const result = await executeHeartbeat(heartbeat);
    
    // 保存到历史
    await saveToHistory(heartbeat, result);
    
    return result;
  }
  
  // 获取心跳运行状态
  static getStatus(projectId: string) {
    const job = runningJobs.get(projectId);
    return {
      running: job?.running || false,
      lastRun: job?.lastRun,
      nextRun: job?.nextRun,
      lastResult: job?.lastResult
    };
  }
  
  // 获取所有运行中的心跳状态
  static getAllStatus() {
    const statuses: Record<string, any> = {};
    for (const [projectId, job] of runningJobs.entries()) {
      statuses[projectId] = {
        running: job.running,
        lastRun: job.lastRun,
        nextRun: job.nextRun,
        lastResult: job.lastResult
      };
    }
    return statuses;
  }
  
  // 为某个心跳重新调度（配置更新后调用）
  static async reschedule(heartbeatId: string) {
    const db = await DbService.load();
    const heartbeat = db.heartbeats?.find((h: any) => h.id === heartbeatId);
    
    if (!heartbeat) return;
    
    // 停止项目的所有心跳
    this.stopForProject(heartbeat.projectId);
    
    // 如果启用，重新调度
    if (heartbeat.enabled) {
      await this.startForProject(heartbeat.projectId);
    }
  }
}

// 调度单个心跳
function scheduleHeartbeat(projectId: string, config: HeartbeatConfig) {
  const job = runningJobs.get(projectId);
  if (!job) return;
  
  // 计算延迟（毫秒）
  let delayMs: number;
  
  if (config.intervalMinutes && config.intervalMinutes > 0) {
    delayMs = config.intervalMinutes * 60 * 1000;
  } else {
    // 默认 30 分钟
    delayMs = 30 * 60 * 1000;
  }
  
  // 设置下一次执行时间
  const nextRun = new Date(Date.now() + delayMs);
  job.nextRun = nextRun.toISOString();
  
  console.log(`[Heartbeat] Scheduled "${config.name}" for ${nextRun.toLocaleString('zh-CN')} (every ${config.intervalMinutes || 30}min)`);
  
  // 设置定时器
  job.timer = setTimeout(async () => {
    if (!job.running) return;
    
    console.log(`[Heartbeat] Executing: ${config.name}`);
    
    const result = await executeHeartbeat(config);
    job.lastRun = new Date().toISOString();
    job.lastResult = result;
    
    // 保存历史
    await saveToHistory(config, result);
    
    // 计算下一次执行
    const nextDelay = (config.intervalMinutes || 30) * 60 * 1000;
    job.nextRun = new Date(Date.now() + nextDelay).toISOString();
    
    // 继续调度下一次
    if (job.running) {
      scheduleHeartbeat(projectId, config);
    }
  }, delayMs);
}

// 导出事件监听器供外部使用
export { eventEmitter };

// 在服务启动时自动恢复所有项目的心跳调度
export async function restoreHeartbeats() {
  console.log(`[Heartbeat] Restoring heartbeat schedules...`);
  
  const db = await DbService.load();
  const heartbeats = db.heartbeats || [];
  
  // 按项目分组
  const projectHeartbeats = new Map<string, HeartbeatConfig[]>();
  for (const hb of heartbeats) {
    if (hb.enabled) {
      if (!projectHeartbeats.has(hb.projectId)) {
        projectHeartbeats.set(hb.projectId, []);
      }
      projectHeartbeats.get(hb.projectId)!.push(hb);
    }
  }
  
  // 为每个有启用心跳的项目启动调度
  for (const [projectId, configs] of projectHeartbeats.entries()) {
    console.log(`[Heartbeat] Restoring ${configs.length} heartbeat(s) for project ${projectId}`);
    
    const job: RunningJob = { running: true, timer: null };
    
    for (const config of configs) {
      scheduleHeartbeat(projectId, config);
    }
    
    runningJobs.set(projectId, job);
  }
  
  console.log(`[Heartbeat] Restored ${projectHeartbeats.size} project(s) with active heartbeats`);
}
