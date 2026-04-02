/**
 * 流式响应配置
 * 
 * 通过此文件控制是否启用流式模式
 */

// 是否启用流式响应
// 设置为 true 时，chat 路由会使用 stream: true
// 设置为 false 时，使用传统的非流式模式
export const STREAMING_ENABLED = process.env.USE_STREAMING === 'true' || false;

// 流式响应配置
export const STREAMING_CONFIG = {
  // 是否启用流式模式
  enabled: STREAMING_ENABLED,
  
  // 最大 token 数（用于流式请求）
  maxTokens: 8192,
  
  // 温度参数
  temperature: 0.7,
  
  // 工具调用循环最大次数
  maxGuardLoops: 8,
  
  // 是否在日志中显示流式详情
  debugLogging: true,
};

export default STREAMING_CONFIG;
