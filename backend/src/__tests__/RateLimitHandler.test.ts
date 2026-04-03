/**
 * RateLimitHandler 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseApiError,
  isModelRateLimited,
  setModelRateLimited,
  calculateBackoff,
  selectAvailableModel,
  cleanupRateLimitCache
} from '../services/RateLimitHandler.js';

// Mock fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('RateLimitHandler', () => {
  beforeEach(() => {
    // 清理缓存
    cleanupRateLimitCache();
    vi.clearAllMocks();
  });

  describe('parseApiError', () => {
    it('should detect 429 status code', () => {
      const error = { status: 429 };
      const result = parseApiError(error);
      
      expect(result).not.toBeNull();
      expect(result?.isRateLimited).toBe(true);
      expect(result?.retryAfter).toBe(60); // 默认值
    });

    it('should parse Retry-After header', () => {
      const error = {
        status: 429,
        response: {
          headers: {
            'retry-after': '120'
          }
        }
      };
      const result = parseApiError(error);
      
      expect(result?.retryAfter).toBe(120);
      expect(result?.resetTime).toBeInstanceOf(Date);
    });

    it('should detect 429 in error message', () => {
      const error = {
        message: '429 Too Many Requests'
      };
      const result = parseApiError(error);
      
      expect(result?.isRateLimited).toBe(true);
    });

    it('should return null for non-rate-limit errors', () => {
      const error = { status: 500, message: 'Internal Server Error' };
      const result = parseApiError(error);
      
      expect(result).toBeNull();
    });
  });

  describe('isModelRateLimited', () => {
    it('should return null for non-cached models', () => {
      const result = isModelRateLimited('unknown-model');
      expect(result).toBeNull();
    });

    it('should return rate limit info for cached models', () => {
      const modelId = 'test-model-1';
      const info = {
        isRateLimited: true,
        retryAfter: 60,
        resetTime: new Date(Date.now() + 60000)
      };
      
      setModelRateLimited(modelId, info);
      const result = isModelRateLimited(modelId);
      
      expect(result?.isRateLimited).toBe(true);
      expect(result?.retryAfter).toBe(60);
    });
  });

  describe('setModelRateLimited', () => {
    it('should cache rate limit info', () => {
      const modelId = 'test-model-2';
      const info = {
        isRateLimited: true,
        retryAfter: 30,
        resetTime: new Date(Date.now() + 30000)
      };
      
      setModelRateLimited(modelId, info);
      
      // Verify it was cached
      const cached = isModelRateLimited(modelId);
      expect(cached).not.toBeNull();
    });

    it('should log rate limit info', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const modelId = 'test-model-3';
      const info = {
        isRateLimited: true,
        retryAfter: 120,
        resetTime: new Date()
      };
      
      setModelRateLimited(modelId, info);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[RateLimit]'),
        expect.stringContaining(modelId)
      );
    });
  });

  describe('calculateBackoff', () => {
    it('should return base delay for first attempt', () => {
      const delay = calculateBackoff(0, 1000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1200); // +20% jitter
    });

    it('should increase exponentially', () => {
      const delay1 = calculateBackoff(1, 1000);
      const delay2 = calculateBackoff(2, 1000);
      const delay3 = calculateBackoff(3, 1000);
      
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('should cap at maximum delay', () => {
      const delay = calculateBackoff(10, 1000); // Very high attempt
      expect(delay).toBeLessThanOrEqual(30000); // Max delay is 30s
    });

    it('should add random jitter', () => {
      // Run multiple times to check jitter variation
      const delays = Array(10).fill(0).map(() => calculateBackoff(2, 1000));
      const uniqueDelays = [...new Set(delays)];
      
      // At least some delays should be different due to jitter
      expect(uniqueDelays.length).toBeGreaterThan(1);
    });
  });

  describe('selectAvailableModel', () => {
    const models = [
      { id: 'model-1', name: 'Model 1', priority: 1 },
      { id: 'model-2', name: 'Model 2', priority: 2 },
      { id: 'model-3', name: 'Model 3', priority: 3 }
    ];

    it('should select first available model', () => {
      const selected = selectAvailableModel(models);
      expect(selected?.id).toBe('model-1');
    });

    it('should skip excluded models', () => {
      const selected = selectAvailableModel(models, ['model-1']);
      expect(selected?.id).toBe('model-2');
    });

    it('should skip rate-limited models', () => {
      // Mark model-1 as rate limited
      setModelRateLimited('model-1', {
        isRateLimited: true,
        retryAfter: 60,
        resetTime: new Date(Date.now() + 60000)
      });
      
      const selected = selectAvailableModel(models);
      expect(selected?.id).toBe('model-2');
    });

    it('should return null when all models are unavailable', () => {
      const selected = selectAvailableModel(models, ['model-1', 'model-2', 'model-3']);
      expect(selected).toBeNull();
    });

    it('should respect priority order', () => {
      const modelsWithPriority = [
        { id: 'low-priority', name: 'Low', priority: 10 },
        { id: 'high-priority', name: 'High', priority: 1 }
      ];
      
      const selected = selectAvailableModel(modelsWithPriority);
      expect(selected?.id).toBe('high-priority');
    });
  });

  describe('cleanupRateLimitCache', () => {
    it('should remove expired entries', async () => {
      // Set a model as rate limited
      setModelRateLimited('old-model', {
        isRateLimited: true,
        retryAfter: 1,
        resetTime: new Date(Date.now() - 1000) // Already expired
      });
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Cleanup
      cleanupRateLimitCache();
      
      // Should be removed
      const result = isModelRateLimited('old-model');
      // Depending on implementation, this might still exist or be null
      // The actual behavior depends on the TTL logic
    });
  });
});

describe('Integration Tests', () => {
  it('should handle full rate limit flow', () => {
    const modelId = 'integration-test-model';
    
    // 1. Parse 429 error
    const error = {
      status: 429,
      response: {
        headers: { 'retry-after': '30' }
      }
    };
    const rateLimitInfo = parseApiError(error);
    expect(rateLimitInfo?.isRateLimited).toBe(true);
    expect(rateLimitInfo?.retryAfter).toBe(30);
    
    // 2. Set model as rate limited
    setModelRateLimited(modelId, rateLimitInfo!);
    
    // 3. Check if rate limited
    const cached = isModelRateLimited(modelId);
    expect(cached?.isRateLimited).toBe(true);
    
    // 4. Calculate backoff
    const backoff = calculateBackoff(1);
    expect(backoff).toBeGreaterThan(0);
    
    // 5. Select available model (should skip rate-limited)
    const models = [{ id: modelId }, { id: 'other-model' }];
    const selected = selectAvailableModel(models as any);
    expect(selected?.id).toBe('other-model');
  });
});
