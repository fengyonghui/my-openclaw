import { useRef } from 'react';

export function useChatStream(chatId: string, projectId: string, setMessages: any, setIsTyping: any, setInput: any, setAttachments: any, setVoiceInput: any) {
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = async () => {
    abortControllerRef.current?.abort();
    if (chatId) {
      try {
        await fetch(`http://localhost:3001/api/v1/chats/${chatId}/stop`, { method: 'POST' });
        setIsTyping(false);
      } catch (err) { console.error(err); }
    }
  };

  const handleSend = async (text: string, attachments: any[], assistantId: string) => {
    setIsTyping(true);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`http://localhost:3001/api/v1/chats/${chatId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          attachments: attachments.map(a => ({ id: a.id, name: a.name, type: a.type, size: a.size, dataUrl: a.dataUrl }))
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.body) throw new Error('网络连接异常');
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullContent = '';
      let currentId = assistantId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // ... (此处填入您原有的解析逻辑，确保所有 try/catch 正确闭合)
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsTyping(false);
    }
  };

  return { handleSend, handleStop };
}