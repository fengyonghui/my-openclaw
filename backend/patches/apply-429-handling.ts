/**
 * chats.ts 429 错误处理补丁
 * 
 * 由于文件编辑器对大文件处理有限制，请手动应用以下修改：
 * 
 * 1. 在文件开头的导入部分（约第10行），确认已添加：
 *    import { parseApiError, isModelRateLimited, setModelRateLimited, calculateBackoff } from '../services/RateLimitHandler.js';
 * 
 * 2. 找到 catch 块（约第1595行），将以下代码：
 */

// ============ 原代码（需要替换） ============
/*
} catch (err: any) {
  modelRetryCount++;
  console.error(`[Model Fail] ${modelCfg.name} failed (attempt ${modelRetryCount}/${MAX_RETRIES}): ${err.message}`);
  lastError = err.message;
  if (modelRetryCount < MAX_RETRIES) {
    console.log(`[Model] Retrying ${modelCfg.name} in ${RETRY_DELAY_MS}ms...`);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
*/

// ============ 新代码（替换为） ============
const NEW_CATCH_BLOCK = `
} catch (err: any) {
  modelRetryCount++;
  console.error(\`[Model Fail] \${modelCfg.name} failed (attempt \${modelRetryCount}/\${MAX_RETRIES}): \${err.message}\`);
  lastError = err.message;
  
  // --- 429 错误专门处理 ---
  const rateLimitInfo = parseApiError(err);
  if (rateLimitInfo?.isRateLimited) {
    // 记录模型的限流状态
    setModelRateLimited(modelCfg.id, rateLimitInfo);
    console.log(\`[429] \${modelCfg.name} rate limited. Reset at: \${rateLimitInfo.resetTime?.toISOString()}\`);
    
    // 通知前端
    reply.raw.write(\`data: \${JSON.stringify({ 
      type: 'rate_limit',
      model: modelCfg.name,
      retryAfter: rateLimitInfo.retryAfter,
      message: \`⚠️ 模型 \${modelCfg.name} 触发限流，正在切换备用模型...\`
    })}\\\\n\\\\n\`);
    
    // 如果有限流等待时间，使用该时间；否则使用指数退避
    const waitTime = rateLimitInfo.retryAfter 
      ? rateLimitInfo.retryAfter * 1000 
      : calculateBackoff(modelRetryCount);
    
    if (modelRetryCount < MAX_RETRIES) {
      console.log(\`[Model] Waiting \${waitTime / 1000}s before retry...\`);
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 30000)));
    }
  } else {
    // 非 429 错误，使用普通重试
    if (modelRetryCount < MAX_RETRIES) {
      const backoff = calculateBackoff(modelRetryCount);
      console.log(\`[Model] Retrying \${modelCfg.name} in \${backoff}ms...\`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
}
`;

/**
 * 应用补丁的步骤：
 * 
 * 1. 打开文件：/mnt/d/workspace/my-openclaw/backend/src/routes/chats.ts
 * 2. 搜索 "} catch (err: any) {" 和 "modelRetryCount++;"
 * 3. 找到包含 "RETRY_DELAY_MS" 的 catch 块
 * 4. 用上面的 NEW_CATCH_BLOCK 替换整个 catch 块内容
 * 5. 保存文件
 */

export { NEW_CATCH_BLOCK };
