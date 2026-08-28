import { useState, useRef, useCallback } from 'react';
import { ChevronDown, Copy, CheckCircle2, FileText, X as XIcon } from 'lucide-react';
import type { Attachment } from './types';

// 思考块渲染器（默认折叠）
export function ThinkBlock({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <details className="my-3 border border-amber-500/40 rounded-xl bg-amber-950/70 overflow-hidden" open={!collapsed}>
      <summary
        onClick={(e) => { e.preventDefault(); setCollapsed(!collapsed); }}
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer text-xs font-bold text-amber-300 hover:text-amber-100 select-none list-none"
      >
        <span className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}>
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
        🧠 AI 思考过程
        {collapsed && <span className="ml-1 text-amber-600">(已折叠)</span>}
      </summary>
      <div className={`px-4 pb-3 text-xs text-amber-50 whitespace-pre-wrap font-mono leading-relaxed border-t border-amber-500/20 ${collapsed ? 'hidden' : ''}`}>
        {children}
      </div>
    </details>
  );
}

// 代码块渲染器
export function PreBlock(props: any) {
  const children = props?.children;
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = useCallback(() => {
    const text = preRef.current?.innerText || '';
    navigator.clipboard.writeText(text.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <div className="my-4 rounded-2xl border border-slate-700/50 bg-slate-900 shadow-xl overflow-hidden">
      <div className="flex justify-end px-4 pt-3">
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            copied ? 'bg-green-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          {copied ? <><CheckCircle2 className="h-3.5 w-3.5" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
        </button>
      </div>
      <pre ref={preRef} className="p-4 pt-2 text-sm leading-relaxed whitespace-pre-wrap break-words max-w-full font-mono">
        <code className="whitespace-pre-wrap break-words text-slate-100">{children}</code>
      </pre>
    </div>
  );
}

// 附件预览项
export function AttachmentChip({ att, onRemove }: { att: Attachment; onRemove: (id: string) => void }) {
  const isImage = att.type.startsWith('image/');
  return (
    <div className="group relative inline-flex items-center gap-2 bg-gradient-to-r from-slate-100 to-slate-50 rounded-full pl-3 pr-2 py-1.5 animate-in fade-in slide-in-from-left-1">
      {isImage && att.dataUrl ? (
        <img src={att.dataUrl} alt={att.name} className="h-6 w-6 rounded-full object-cover border border-slate-200" />
      ) : (
        <FileText className="h-3.5 w-3.5 text-indigo-500" />
      )}
      <span className="text-xs font-medium text-slate-600 max-w-[100px] truncate">{att.name}</span>
      <button
        onClick={() => onRemove(att.id)}
        className="ml-1 rounded-full p-0.5 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500 transition-all"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
