/**
 * 循环检测器：保护 agent loop 不会无限循环
 *
 * 检测三类问题：
 * 1. 同一签名连续 N 次重复（已有，防 LLM 调同一工具死循环）
 * 2. 消息总数停滞增长：连续多轮 finalMessages 长度不变（说明 LLM 在打空 / 加 system prompt 而非真干活）
 * 3. 同一个工具名被反复调用且没有 final reply
 *
 * 用法：
 *   const guard = new LoopGuard({ maxIterations: 8 });
 *   while (guard.canContinue()) {
 *     // ... business logic
 *     guard.tick({ toolCallSignature, messageCount, toolName });
 *   }
 *   if (guard.shouldAbort()) { break; }
 */

export interface LoopGuardConfig {
  /** 单轮最大迭代次数（与现有 while (guard++ < 8) 对应） */
  maxIterations?: number;
  /** 同一 tool signature 连续重复多少次就触发 */
  sameSignatureStreakLimit?: number;
  /** 消息数连续多少轮不增长就触发 */
  noMessageGrowthStreakLimit?: number;
}

export interface LoopGuardTick {
  /** 当前轮的 tool call 签名（拼接 tool name + args 前 100 字） */
  toolCallSignature?: string;
  /** 当前轮 finalMessages 长度 */
  messageCount?: number;
  /** 当前轮调用的工具名（用于统计工具调用次数） */
  toolName?: string;
}

export class LoopGuard {
  private iterations = 0;
  private sameSigStreak = 0;
  private noGrowthStreak = 0;
  private prevMessageCount = -1;
  private consecutiveToolCallsSinceFinal = 0;
  private lastAbortedReason = '';

  private readonly maxIterations: number;
  private readonly sameSignatureStreakLimit: number;
  private readonly noMessageGrowthStreakLimit: number;

  constructor(cfg: LoopGuardConfig = {}) {
    this.maxIterations = cfg.maxIterations ?? 8;
    this.sameSignatureStreakLimit = cfg.sameSignatureStreakLimit ?? 3;
    this.noMessageGrowthStreakLimit = cfg.noMessageGrowthStreakLimit ?? 3;
  }

  /** 内部用：打印日志前缀 */
  private logPrefix(): string {
    return '[LoopGuard]';
  }

  /** 进入下一轮迭代前调用：检查是否可以继续 */
  canContinue(): boolean {
    if (this.iterations >= this.maxIterations) {
      this.lastAbortedReason = `达到 maxIterations=${this.maxIterations}`;
      console.warn(`${this.logPrefix()} Abort: ${this.lastAbortedReason}`);
      return false;
    }
    if (this.sameSigStreak >= this.sameSignatureStreakLimit) {
      this.lastAbortedReason = `连续 ${this.sameSigStreak} 次相同 tool signature`;
      console.warn(`${this.logPrefix()} Abort: ${this.lastAbortedReason}`);
      return false;
    }
    if (this.noGrowthStreak >= this.noMessageGrowthStreakLimit) {
      this.lastAbortedReason = `连续 ${this.noGrowthStreak} 轮消息数没增长`;
      console.warn(`${this.logPrefix()} Abort: ${this.lastAbortedReason}（说明 LLM 在重复触发 system prompt nudge 而非真干活）`);
      return false;
    }
    if (this.consecutiveToolCallsSinceFinal >= 6) {
      this.lastAbortedReason = `连续 ${this.consecutiveToolCallsSinceFinal} 轮调工具但始终无 final reply`;
      console.warn(`${this.logPrefix()} Abort: ${this.lastAbortedReason}`);
      return false;
    }
    return true;
  }

  /** 每轮结束调用：更新内部计数器 */
  tick(tick: LoopGuardTick): void {
    this.iterations++;

    // 1. 相同签名检测
    if (tick.toolCallSignature) {
      if (tick.toolCallSignature === (this as any)._lastSig) {
        this.sameSigStreak++;
      } else {
        this.sameSigStreak = 1;
      }
      (this as any)._lastSig = tick.toolCallSignature;
    } else {
      this.sameSigStreak = 0;
      (this as any)._lastSig = '';
    }

    // 2. 消息增长检测
    if (typeof tick.messageCount === 'number') {
      if (tick.messageCount === this.prevMessageCount) {
        this.noGrowthStreak++;
      } else {
        this.noGrowthStreak = 0;
      }
      this.prevMessageCount = tick.messageCount;
    }

    // 3. 工具调用计数（无 final reply 累计）
    if (tick.toolName) {
      this.consecutiveToolCallsSinceFinal++;
    } else {
      this.consecutiveToolCallsSinceFinal = 0;
    }
  }

  shouldAbort(): boolean {
    return this.lastAbortedReason !== '';
  }

  abortReason(): string {
    return this.lastAbortedReason;
  }

  /** 调试用：打印当前状态 */
  status(): string {
    return `iter=${this.iterations}/${this.maxIterations}, sameSig=${this.sameSigStreak}, noGrowth=${this.noGrowthStreak}, toolCallsNoFinal=${this.consecutiveToolCallsSinceFinal}`;
  }
}
