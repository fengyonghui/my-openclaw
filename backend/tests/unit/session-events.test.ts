/**
 * SessionEventService 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionEventService } from '../../src/services/SessionEventService';

describe('SessionEventService', () => {
  let service: SessionEventService;

  beforeEach(() => {
    service = new SessionEventService();
    service.clear(); // 清空测试数据
  });

  it('should record events', () => {
    const event = service.record('session_start', {
      projectId: 'proj1',
      chatId: 'chat1',
      agentId: 'agent1',
    });
    expect(event.id).toBeDefined();
    expect(event.type).toBe('session_start');
    expect(event.projectId).toBe('proj1');
  });

  it('should record multiple events', () => {
    service.recordMany([
      { type: 'session_start', data: { projectId: 'proj1', chatId: 'chat1' } },
      { type: 'tool_call', data: { projectId: 'proj1', chatId: 'chat1', toolName: 'read_file' } },
      { type: 'session_end', data: { projectId: 'proj1', chatId: 'chat1' } },
    ]);
    expect(service.getEventCount()).toBe(3);
  });

  it('should query by projectId', () => {
    service.record('session_start', { projectId: 'proj1', chatId: 'chat1' });
    service.record('session_start', { projectId: 'proj2', chatId: 'chat2' });
    const events = service.getProjectEvents('proj1');
    expect(events.length).toBe(1);
    expect(events[0].projectId).toBe('proj1');
  });

  it('should query by chatId', () => {
    service.record('session_start', { projectId: 'proj1', chatId: 'chat1' });
    service.record('session_start', { projectId: 'proj1', chatId: 'chat2' });
    const events = service.getChatEvents('chat1');
    expect(events.length).toBe(1);
    expect(events[0].chatId).toBe('chat1');
  });

  it('should query by event type', () => {
    service.record('session_start', { projectId: 'proj1' });
    service.record('session_end', { projectId: 'proj1' });
    service.record('tool_call', { projectId: 'proj1' });
    const events = service.query({ projectId: 'proj1', type: 'tool_call' });
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('tool_call');
  });

  it('should respect limit', () => {
    for (let i = 0; i < 20; i++) {
      service.record('session_start', { projectId: 'proj1' });
    }
    const events = service.query({ projectId: 'proj1', limit: 5 });
    expect(events.length).toBe(5);
  });

  it('should sort by timestamp descending', () => {
    service.record('session_start', { projectId: 'proj1' });
    service.record('session_end', { projectId: 'proj1' });
    const events = service.query({ projectId: 'proj1' });
    expect(events[0].type).toBe('session_end'); // 最新在前
    expect(events[1].type).toBe('session_start');
  });

  it('should get project stats', () => {
    service.record('session_start', { projectId: 'proj1' });
    service.record('session_start', { projectId: 'proj1' });
    service.record('session_end', { projectId: 'proj1' });
    service.record('tool_call', { projectId: 'proj1' });
    service.record('tool_call', { projectId: 'proj1' });
    service.record('tool_call', { projectId: 'proj1' });
    const stats = service.getProjectStats('proj1');
    expect(stats.totalEvents).toBe(6);
    expect(stats.sessionStarts).toBe(2);
    expect(stats.sessionEnds).toBe(1);
    expect(stats.toolCalls).toBe(3);
  });

  it('should generate event labels', () => {
    service.record('session_start', { projectId: 'proj1' });
    service.record('tool_call', { projectId: 'proj1' });
    service.record('file_lock', { projectId: 'proj1' });
    const events = service.getProjectTimeline('proj1');
    expect(events[0].label).toBeDefined();
    expect(events[1].label).toBeDefined();
    expect(events[2].label).toBeDefined();
  });
});
