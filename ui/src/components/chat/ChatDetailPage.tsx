import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProject } from '../../contexts/ProjectContext';
import { useChatHooks } from './chat-hooks';
import { useChatActions } from './chat-actions';
import { ChatHeader } from './header';
import { MessageList } from './message-list';
import { InputArea } from './input-area';
import { AgentPicker, ModelPicker } from './pickers';
import type { Message } from './types';

export function ChatDetailPage({
  projectId,
  chatId,
  onMinimize,
}: {
  projectId: string;
  chatId: string;
  onMinimize?: () => void;
}) {
  const { agents: projectAgents } = useProject();

  // 这里使用 useState 作为 useChatHooks 的内部实现 — 但 hooks 之间不能直接传递状态
  // 改用更简单的方式：让 ChatDetailPage 自己管 state，hooks 调用 useChatStream 模式
  // 由于 chat-hooks.ts 的 useChatHooks 内部维护 state，这里改用传递 setters 的方式

  // 临时方案：直接在 ChatDetailPage 中维护状态
  // 后续可以将 useChatHooks 拆分，state 在 ChatDetailPage 中，hooks 仅提供 init 函数

  return <ChatDetailImpl projectId={projectId} chatId={chatId} onMinimize={onMinimize} projectAgents={projectAgents} />;
}

// 实际实现：直接在本组件内管 state
function ChatDetailImpl({
  projectId,
  chatId,
  onMinimize,
  projectAgents,
}: {
  projectId: string;
  chatId: string;
  onMinimize?: () => void;
  projectAgents: Array<{ id: string; name: string; role?: string; description?: string }>;
}) {
  const hooks = useChatHooks(chatId, projectId, projectAgents, () => {}, () => {}, () => {}, () => {}, () => {});
  const actions = useChatActions({
    chatId,
    projectId,
    messages: hooks.messages,
    isTyping: hooks.isTyping,
    chat: hooks.chat,
    setMessages: hooks.setMessages,
    setIsTyping: hooks.setIsTyping,
    setInput: hooks.setInput,
    setAttachments: hooks.setAttachments,
    setVoiceInput: hooks.setVoiceInput,
    setNewTitle: hooks.setNewTitle,
    setChat: hooks.setChat,
    initData: hooks.initData,
  });

  // 渲染
  const renderContent = () => (
    <div className={`flex flex-col bg-gradient-to-b from-white to-slate-50 overflow-hidden transition-all duration-300 ${hooks.windowClasses}`}>
      <ChatHeader
        project={hooks.project}
        chat={hooks.chat}
        currentModel={hooks.currentModel}
        currentAgent={hooks.currentAgent}
        isEditingTitle={hooks.isEditingTitle}
        newTitle={hooks.newTitle}
        showAgentPicker={hooks.showAgentPicker}
        showModelPicker={hooks.showModelPicker}
        onEditTitle={() => hooks.setIsEditingTitle(true)}
        onCancelTitle={() => { hooks.setIsEditingTitle(false); hooks.setNewTitle(hooks.chat?.title || ''); }}
        onSaveTitle={() => {
          if (hooks.newTitle.trim()) actions.handleUpdateChat({ title: hooks.newTitle.trim() });
          hooks.setIsEditingTitle(false);
        }}
        onTitleChange={hooks.setNewTitle}
        onToggleAgentPicker={() => { hooks.setShowAgentPicker(!hooks.showAgentPicker); hooks.setShowModelPicker(false); }}
        onToggleModelPicker={() => { hooks.setShowModelPicker(!hooks.showModelPicker); hooks.setShowAgentPicker(false); }}
        onDownload={actions.downloadChat}
        onClearHistory={() => actions.handleClearHistory(hooks.setMessages)}
        onMinimize={() => onMinimize?.()}
        onToggleMaximize={() => hooks.setWindowState(hooks.windowState === 'normal' ? 'maximized' : 'normal')}
        windowState={hooks.windowState}
      />

      {hooks.windowState !== 'minimized' && (
        <>
          {hooks.showAgentPicker && (
            <AgentPicker
              agents={projectAgents}
              currentAgentId={hooks.chat?.agentId}
              onSelect={(id) => actions.handleUpdateChat({ agentId: id })}
              onClose={() => hooks.setShowAgentPicker(false)}
            />
          )}

          {hooks.showModelPicker && (
            <ModelPicker
              models={hooks.models}
              activeModelId={hooks.activeModelId}
              onSwitch={(id) => {
                actions.handleUpdateChat({ modelId: id });
                hooks.setShowModelPicker(false);
              }}
              onClose={() => hooks.setShowModelPicker(false)}
            />
          )}

          <MessageList
            messages={hooks.messages}
            scrollRef={hooks.scrollRef}
            currentAgentName={hooks.currentAgent?.name}
            isTyping={hooks.isTyping}
            handleResend={(m: Message) => actions.handleResend(m, hooks.setMessages, hooks.setIsTyping)}
            handleDelete={(m: Message) => actions.handleDelete(m, hooks.setMessages)}
          />

          <InputArea
            attachments={hooks.attachments}
            isRecording={hooks.isRecording}
            voiceInput={hooks.voiceInput}
            input={hooks.input}
            isTyping={hooks.isTyping}
            canSend={hooks.canSend}
            fileInputRef={hooks.fileInputRef}
            textareaRef={hooks.textareaRef}
            onFileChange={(e) => {
              if (e.target.files) {
                Array.from(e.target.files).forEach(f => hooks.addFileAsAttachment(f));
                e.target.value = '';
              }
            }}
            onInput={hooks.setInput}
            onVoiceInput={hooks.setVoiceInputLocal}
            onToggleVoice={hooks.toggleVoice}
            onSend={() => actions.handleSend(
              hooks.buildUserContent(),
              hooks.attachments,
              hooks.setMessages,
              hooks.setIsTyping,
              hooks.setInput,
              hooks.setAttachments,
              hooks.setVoiceInputLocal,
            )}
            onStop={actions.handleStop}
            onRemoveAttachment={hooks.removeAttachment}
            onRecordingTextChange={hooks.setVoiceInputLocal}
          />
        </>
      )}
    </div>
  );

  if (hooks.windowState === 'maximized') {
    return createPortal(renderContent(), document.body);
  }
  return renderContent();
}
