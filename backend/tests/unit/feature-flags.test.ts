/**
 * FeatureFlags 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FeatureFlagService } from '../../src/services/FeatureFlags';

describe('FeatureFlags', () => {
  let flags: FeatureFlagService;

  beforeEach(() => {
    flags = new FeatureFlagService();
    flags.reset();
  });

  it('should initialize with default flags', () => {
    const all = flags.getAll();
    expect(all.length).toBeGreaterThan(0);
  });

  it('should check if enabled', () => {
    const enabled = flags.isEnabled('runtime_status_panel');
    expect(typeof enabled).toBe('boolean');
  });

  it('should evaluate with reason', () => {
    const result = flags.evaluate('runtime_status_panel', { projectId: 'proj1' });
    expect(result.key).toBe('runtime_status_panel');
    expect(result.reason).toBeDefined();
  });

  it('should set enabled', () => {
    flags.setEnabled('streaming_mode', true);
    const flag = flags.get('streaming_mode');
    expect(flag?.enabled).toBe(true);
  });

  it('should set rollout percentage', () => {
    flags.setRollout('streaming_mode', 50);
    const flag = flags.get('streaming_mode');
    expect(flag?.rollout).toBe(50);
  });

  it('should clamp rollout to 0-100', () => {
    flags.setRollout('streaming_mode', 150);
    expect(flags.get('streaming_mode')?.rollout).toBe(100);
    flags.setRollout('streaming_mode', -10);
    expect(flags.get('streaming_mode')?.rollout).toBe(0);
  });

  it('should return false for unknown flags', () => {
    const enabled = flags.isEnabled('nonexistent_feature');
    expect(enabled).toBe(false);
  });

  it('should update flag', () => {
    flags.update('streaming_mode', { description: 'Updated description' });
    const flag = flags.get('streaming_mode');
    expect(flag?.description).toBe('Updated description');
  });

  it('should evaluate rollout deterministically', () => {
    // 相同 projectId 应该得到相同结果
    const result1 = flags.evaluate('streaming_mode', { projectId: 'proj123' });
    const result2 = flags.evaluate('streaming_mode', { projectId: 'proj123' });
    expect(result1.enabled).toBe(result2.enabled);
  });
});
