import { Paperclip, Mic, MicOff, Square, SendHorizonal } from 'lucide-react';
import { AttachmentChip } from './renderers';
import type { Attachment } from './types';

export function InputArea({
  attachments,
  isRecording,
  voiceInput,
  input,
  isTyping,
  canSend,
  fileInputRef,
  textareaRef,
  onFileChange,
  onInput,
  onVoiceInput,
  onToggleVoice,
  onSend,
  onStop,
  onRemoveAttachment,
  onRecordingTextChange,
}: {
  attachments: Attachment[];
  isRecording: boolean;
  voiceInput: string;
  input: string;
  isTyping: boolean;
  canSend: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onInput: (val: string) => void;
  onVoiceInput: (val: string) => void;
  onToggleVoice: () => void;
  onSend: () => void;
  onStop: () => void;
  onRemoveAttachment: (id: string) => void;
  onRecordingTextChange: (val: string) => void;
}) {
  return (
    <div className="flex-shrink-0 p-6 bg-white border-t border-slate-100">
      {/* 附件预览 */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 max-w-4xl mx-auto">
          {attachments.map(att => (
            <AttachmentChip key={att.id} att={att} onRemove={onRemoveAttachment} />
          ))}
        </div>
      )}

      {/* 录音提示 */}
      {isRecording && voiceInput && (
        <div className="mb-4 max-w-4xl mx-auto flex items-center gap-3 bg-gradient-to-r from-red-50 to-rose-50 border border-red-100 rounded-2xl px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <span className="text-sm text-red-600 font-medium italic flex-1">{voiceInput}</span>
          <button onClick={onStop} className="text-xs text-red-400 hover:text-red-600 font-bold">停止</button>
        </div>
      )}

      <div className="relative max-w-4xl mx-auto">
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFileChange} />

        <textarea
          ref={textareaRef}
          value={isRecording ? (input + voiceInput) : input}
          onChange={(e) => {
            if (isRecording) {
              onRecordingTextChange(e.target.value.slice(input.length + voiceInput.length));
            } else {
              onInput(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files) Array.from(files).forEach(f => fileInputRef.current?.dispatchEvent(new Event('change')));
          }}
          onDragOver={(e) => e.preventDefault()}
          placeholder={isTyping ? '正在思考...' : '输入消息，支持图片/文件/语音输入...'}
          disabled={isTyping}
          className="w-full bg-gradient-to-r from-slate-50 to-indigo-50/30 border border-slate-200 rounded-3xl px-6 py-5 text-sm shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50/50 transition-all resize-none disabled:opacity-50"
        />

        {/* 工具栏 */}
        <div className="absolute right-4 bottom-4 flex items-center gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-all">
            <Paperclip className="h-5 w-5 text-slate-500" />
          </button>
          <button
            onClick={onToggleVoice}
            className={`p-2.5 rounded-xl transition-all ${
              isRecording
                ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-200'
                : 'bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-500'
            }`}
          >
            {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          {isTyping ? (
            <button
              onClick={onStop}
              className="p-3 rounded-2xl shadow-lg transition-all bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 hover:scale-105 active:scale-95 shadow-red-200"
            >
              <Square className="h-5 w-5 text-white" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!canSend}
              className={`p-3 rounded-2xl shadow-lg transition-all ${
                canSend
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 hover:scale-105 active:scale-95 shadow-indigo-200'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              <SendHorizonal className="h-5 w-5 text-white" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
