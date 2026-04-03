#!/usr/bin/env node
/**
 * 自动应用 429 错误处理补丁到 chats.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const CHATS_FILE = path.join(__dirname, '../src/routes/chats.ts');

// 旧代码模式
const OLD_PATTERN = `} catch (err: any) {
      modelRetryCount++;
      console.error(\`[Model Fail] \${modelCfg.name} failed (attempt \${modelRetryCount}/\${MAX_RETRIES}): \${err.message}\`);
      lastError = err.message;
      if (modelRetryCount < MAX_RETRIES) {
        console.log(\`[Model] Retrying \${modelCfg.name} in \${RETRY_DELAY_MS}ms...\`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }`;

// 新代码
const NEW_CODE = `} catch (err: any) {
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
    }`;

function applyPatch() {
  console.log('📋 Reading chats.ts...');
  
  let content = fs.readFileSync(CHATS_FILE, 'utf-8');
  
  // 检查是否已经应用过补丁
  if (content.includes('// --- 429 错误专门处理 ---')) {
    console.log('✅ 补丁已应用，跳过');
    return;
  }
  
  // 查找并替换
  if (!content.includes(OLD_PATTERN)) {
    console.log('❌ 未找到目标代码模式');
    console.log('📝 请手动应用补丁');
    return;
  }
  
  content = content.replace(OLD_PATTERN, NEW_CODE);
  
  // 备份原文件
  const backupFile = CHATS_FILE + '.backup';
  fs.writeFileSync(backupFile, fs.readFileSync(CHATS_FILE));
  console.log(`📦 已备份到: ${backupFile}`);
  
  // 写入新文件
  fs.writeFileSync(CHATS_FILE, content);
  console.log('✅ 补丁应用成功！');
}

applyPatch();
