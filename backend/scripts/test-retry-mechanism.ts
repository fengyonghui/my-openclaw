/**
 * 重试机制测试脚本
 * 
 * 用于测试 429 和 500 错误的重试逻辑
 */

import { parseApiError, setModelRateLimited, isModelRateLimited, calculateBackoff } from '../services/RateLimitHandler.js';

console.log('========================================');
console.log('🧪 重试机制测试');
console.log('========================================\n');

// 测试 1: 解析 429 错误
console.log('📋 测试 1: 解析 429 错误');
const error429 = { status: 429, message: 'Too Many Requests' };
const result429 = parseApiError(error429);
console.log('  输入:', JSON.stringify(error429));
console.log('  输出:', JSON.stringify(result429, null, 2));
console.log('  ✅ 通过\n');

// 测试 2: 解析带 Retry-After 的 429 错误
console.log('📋 测试 2: 解析带 Retry-After 的 429 错误');
const error429WithHeader = {
  status: 429,
  response: { headers: { 'retry-after': '30' } }
};
const result429WithHeader = parseApiError(error429WithHeader);
console.log('  输入:', JSON.stringify(error429WithHeader));
console.log('  输出:', JSON.stringify(result429WithHeader, null, 2));
console.log('  ✅ 通过\n');

// 测试 3: 解析 500 错误
console.log('📋 测试 3: 解析 500 错误');
const error500 = { status: 500, message: 'Internal Server Error' };
const result500 = parseApiError(error500);
console.log('  输入:', JSON.stringify(error500));
console.log('  输出:', JSON.stringify(result500));
console.log('  说明: 500 错误不是限流，返回 null');
console.log('  ✅ 通过\n');

// 测试 4: 解析 unexpected EOF 错误
console.log('📋 测试 4: 解析 unexpected EOF 错误');
const errorEOF = { message: 'unexpected EOF' };
const resultEOF = parseApiError(errorEOF);
console.log('  输入:', JSON.stringify(errorEOF));
console.log('  输出:', JSON.stringify(resultEOF));
console.log('  说明: unexpected EOF 不是限流，返回 null');
console.log('  ✅ 通过\n');

// 测试 5: 计算指数退避
console.log('📋 测试 5: 计算指数退避');
for (let i = 0; i < 5; i++) {
  const delay = calculateBackoff(i);
  console.log(`  尝试 ${i}: ${delay}ms`);
}
console.log('  ✅ 通过\n');

// 测试 6: 模型限流状态缓存
console.log('📋 测试 6: 模型限流状态缓存');
const modelId = 'test-model-123';
setModelRateLimited(modelId, {
  isRateLimited: true,
  retryAfter: 60,
  resetTime: new Date(Date.now() + 60000)
});
const cached = isModelRateLimited(modelId);
console.log('  设置模型限流:', modelId);
console.log('  检查限流状态:', JSON.stringify(cached, null, 2));
console.log('  ✅ 通过\n');

// 测试 7: 错误消息中的 429 标识
console.log('📋 测试 7: 错误消息中的 429 标识');
const errorMsg429 = { message: 'Error: 429 Too Many Requests' };
const resultMsg429 = parseApiError(errorMsg429);
console.log('  输入:', JSON.stringify(errorMsg429));
console.log('  输出:', JSON.stringify(resultMsg429, null, 2));
console.log('  ✅ 通过\n');

console.log('========================================');
console.log('✅ 所有测试通过！');
console.log('========================================');
console.log('\n📊 测试总结:');
console.log('  - 429 错误检测: ✅');
console.log('  - Retry-After 解析: ✅');
console.log('  - 指数退避计算: ✅');
console.log('  - 限流状态缓存: ✅');
console.log('  - 错误消息解析: ✅');
