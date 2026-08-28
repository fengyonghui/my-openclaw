import { useRef, useEffect } from 'react';
import { MessageBubble, ToolResult, EmptyState } from './message-renderer';
import type { Message } from './types';

export function MessageList({
  messages,
  scrollRef,
  currentAgentName,
  isTyping,
  handleResend,
  handleDelete,
}: {
  messages: Message[];
  scrollRef: React.RefObject<HTMLDivElement>;
  currentAgentName?: string;
  isTyping: boolean;
  handleResend?: (msg: Message) => void;
  handleDelete?: (msg: Message) => void;
}) {
  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, scrollRef]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-8">
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6 max-w-4xl mx-auto">
          {messages.map((m) => {
            if (m.role === 'tool') {
              return <ToolResult key={m.id} m={m} />;
            }
            return (
              <MessageBubble
                key={m.id}
                m={m}
                currentAgentName={currentAgentName}
                isTyping={isTyping}
                handleResend={handleResend}
                handleDelete={handleDelete}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
