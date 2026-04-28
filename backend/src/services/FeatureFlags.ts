/**
 * FeatureFlags - 功能开关服务
 * 
 * Phase 6: 灰度发布和功能开关基础设施
 * 支持按项目、环境、用户百分比启用功能
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================
// 类型定义
// ============================================

export interface FeatureFlag {
  key: string;           // 唯一标识
  name: string;          // 友好名称
  description: string;   // 描述
  enabled: boolean;      // 全局开关
  rollout: number;       // 灰度百分比 0-100
  projectIds?: string[]; // 特定项目（优先）
  environments?: string[];// 特定环境
  createdAt: number;
  updatedAt: number;
}

export interface FlagEvaluation {
  key: string;
  enabled: boolean;
  reason: string;
}

// ============================================
// 常量
// ============================================

const FLAGS_FILE = 'data/feature-flags.json';
const DEFAULT_FLAGS: FeatureFlag[] = [
  {
    key: 'runtime_status_panel',
    name: '运行时状态面板',
    description: '在项目仪表盘显示实时运行状态面板',
    enabled: true,
    rollout: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    key: 'workspace_lock',
    name: 'Workspace 文件锁',
    description: '防止多个会话同时修改同一文件',
    enabled: true,
    rollout: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    key: 'session_events',
    name: '会话事件记录',
    description: '记录所有会话事件用于审计',
    enabled: true,
    rollout: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    key: 'streaming_mode',
    name: '流式生成模式',
    description: '使用 SSE 流式响应替代批响应',
    enabled: false,
    rollout: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    key: 'agent_delegation',
    name: 'Agent 委托功能',
    description: '允许 Agent 之间相互委托任务',
    enabled: false,
    rollout: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    key: 'memory_auto_save',
    name: '自动记忆保存',
    description: '自动将对话要点保存到 MEMORY.md',
    enabled: false,
    rollout: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

// ============================================
// 单例
// ============================================

class FeatureFlagService {
  private flags: Map<string, FeatureFlag> = new Map();
  private storagePath: string = FLAGS_FILE;
  private initialized = false;

  constructor() {
    this.load();
  }

  // ==========================================
  // 初始化
  // ==========================================

  private load(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
        for (const flag of data) {
          this.flags.set(flag.key, flag);
        }
        console.log(`[FeatureFlags] Loaded ${this.flags.size} flags`);
      } else {
        // 使用默认 flags
        for (const flag of DEFAULT_FLAGS) {
          this.flags.set(flag.key, flag);
        }
        this.save();
        console.log(`[FeatureFlags] Initialized with ${DEFAULT_FLAGS.length} default flags`);
      }
      this.initialized = true;
    } catch (err) {
      console.error('[FeatureFlags] Failed to load flags:', err);
      for (const flag of DEFAULT_FLAGS) {
        this.flags.set(flag.key, flag);
      }
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify(Array.from(this.flags.values()), null, 2),
        'utf-8'
      );
    } catch (err) {
      console.error('[FeatureFlags] Failed to save flags:', err);
    }
  }

  // ==========================================
  // 查询
  // ==========================================

  /**
   * 检查功能是否启用
   */
  isEnabled(
    key: string,
    context: { projectId?: string; environment?: string } = {}
  ): boolean {
    const flag = this.flags.get(key);
    if (!flag) return false;
    if (!flag.enabled) return false;

    // 特定项目优先
    if (flag.projectIds && flag.projectIds.length > 0) {
      if (context.projectId && flag.projectIds.includes(context.projectId)) {
        return true;
      }
      // 有特定项目但当前不在列表中 → 关闭
      return false;
    }

    // 灰度百分比
    if (flag.rollout >= 100) return true;
    if (flag.rollout <= 0) return false;

    // 基于项目 ID 的确定性灰度
    if (context.projectId) {
      const hash = this.hash(`${context.projectId}:${key}`);
      return (hash % 100) < flag.rollout;
    }

    return false;
  }

  /**
   * 评估功能开关（带原因）
   */
  evaluate(key: string, context: { projectId?: string; environment?: string } = {}): FlagEvaluation {
    const flag = this.flags.get(key);
    if (!flag) {
      return { key, enabled: false, reason: 'flag_not_found' };
    }
    if (!flag.enabled) {
      return { key, enabled: false, reason: 'globally_disabled' };
    }
    if (flag.projectIds && flag.projectIds.length > 0) {
      if (context.projectId && flag.projectIds.includes(context.projectId)) {
        return { key, enabled: true, reason: 'project_in_whitelist' };
      }
      return { key, enabled: false, reason: 'project_not_in_whitelist' };
    }
    if (flag.rollout >= 100) {
      return { key, enabled: true, reason: 'full_rollout' };
    }
    if (flag.rollout <= 0) {
      return { key, enabled: false, reason: 'zero_rollout' };
    }
    if (context.projectId) {
      const hash = this.hash(`${context.projectId}:${key}`);
      const enabled = (hash % 100) < flag.rollout;
      return { key, enabled, reason: enabled ? 'rollout_included' : 'rollout_excluded' };
    }
    return { key, enabled: false, reason: 'no_context_for_rollout' };
  }

  // ==========================================
  // 管理
  // ==========================================

  /**
   * 获取所有功能开关
   */
  getAll(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  /**
   * 获取单个功能开关
   */
  get(key: string): FeatureFlag | undefined {
    return this.flags.get(key);
  }

  /**
   * 更新功能开关
   */
  update(key: string, updates: Partial<FeatureFlag>): FeatureFlag | null {
    const flag = this.flags.get(key);
    if (!flag) return null;

    const updated: FeatureFlag = {
      ...flag,
      ...updates,
      key, // 不可更改
      updatedAt: Date.now(),
    };

    this.flags.set(key, updated);
    this.save();
    return updated;
  }

  /**
   * 创建新功能开关
   */
  create(flag: Omit<FeatureFlag, 'createdAt' | 'updatedAt'>): FeatureFlag | null {
    if (this.flags.has(flag.key)) {
      return null; // 已存在
    }

    const newFlag: FeatureFlag = {
      ...flag,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.flags.set(flag.key, newFlag);
    this.save();
    return newFlag;
  }

  /**
   * 删除功能开关
   */
  delete(key: string): boolean {
    const existed = this.flags.delete(key);
    if (existed) this.save();
    return existed;
  }

  /**
   * 批量启用/禁用
   */
  setEnabled(key: string, enabled: boolean): FeatureFlag | null {
    return this.update(key, { enabled });
  }

  /**
   * 设置灰度百分比
   */
  setRollout(key: string, rollout: number): FeatureFlag | null {
    return this.update(key, { rollout: Math.max(0, Math.min(100, rollout)) });
  }

  // ==========================================
  // 工具
  // ==========================================

  private hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转为32位整数
    }
    return Math.abs(hash);
  }

  /**
   * 重置为默认
   */
  reset(): void {
    this.flags.clear();
    for (const flag of DEFAULT_FLAGS) {
      this.flags.set(flag.key, flag);
    }
    this.save();
  }
}

// 单例导出
export const featureFlags = new FeatureFlagService();

export default featureFlags;
