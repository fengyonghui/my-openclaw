import { useState, useEffect, useMemo } from 'react';
import { Plus, X, Check, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui';

// ───────── 类型定义 ─────────
export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
}

export interface AddModelForm {
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
}

export const EMPTY_FORM: AddModelForm = {
  name: '',
  provider: '',
  baseUrl: '',
  apiKey: '',
  modelId: '',
  temperature: 0.7,
  maxTokens: 4096,
};

export const PROVIDER_PRESETS: Record<string, { baseUrl: string; label: string; color: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', label: 'OpenAI', color: 'bg-emerald-50 text-emerald-700' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', label: 'Anthropic', color: 'bg-amber-50 text-amber-700' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', label: 'DeepSeek', color: 'bg-blue-50 text-blue-700' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', label: 'Google', color: 'bg-rose-50 text-rose-700' },
  custom: { baseUrl: '', label: '自定义', color: 'bg-slate-100 text-slate-600' },
};

// ───────── 添加模型弹窗组件 ─────────
export function AddModelDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (models: ModelConfig[]) => void;
}) {
  const [form, setForm] = useState<AddModelForm>({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [isManualMode, setIsManualMode] = useState(false); // 新增状态

  // 验证
  const validation = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = '请输入模型名称';
    if (!form.provider.trim()) errors.provider = '请输入 Provider';
    if (!form.modelId.trim()) errors.modelId = '请输入 Model ID';
    if (!form.baseUrl.trim()) errors.baseUrl = '请输入 Base URL';
    if (!form.apiKey.trim() && !isManualMode) errors.apiKey = '请输入 API Key'; // 简单处理
    if (form.temperature < 0 || form.temperature > 2) errors.temperature = 'Temperature 范围 0~2';
    if (form.maxTokens < 1) errors.maxTokens = 'Max Tokens 必须大于 0';
    return errors;
  }, [form, isManualMode]);

  const isValid = Object.keys(validation).length === 0;

  const handlePresetChange = (presetKey: string) => {
    setSelectedPreset(presetKey);
    setIsManualMode(false);
    const preset = PROVIDER_PRESETS[presetKey];
    if (preset) {
      setForm(prev => ({
        ...prev,
        provider: presetKey === 'custom' ? '' : presetKey,
        baseUrl: preset.baseUrl || '',
      }));
    }
  };

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('http://localhost:3001/api/v1/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `manual-${Date.now()}`,
          name: form.name.trim(),
          provider: form.provider.trim(),
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
          modelId: form.modelId.trim(),
          temperature: form.temperature,
          maxTokens: form.maxTokens,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '添加失败');
      }

      // POST 单个模型返回的是全量数组
      const data = await res.json();
      const allModels = Array.isArray(data) ? data : [];
      onSuccess(allModels);
    } catch (err: any) {
      setError(err.message || '添加模型失败，请检查网络');
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = <K extends keyof AddModelForm>(key: K, value: AddModelForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setError('');
  };

  // 键盘事件：ESC关闭，Enter提交
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && isValid && !submitting) handleSubmit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid, submitting]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="手动添加模型">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-xl mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary-50 rounded-xl">
              <Plus className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">手动添加模型</h2>
              <p className="text-xs text-slate-400 font-medium mt-0.5">配置 LLM 的连接参数</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-8 pb-2 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Provider Presets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Provider 快捷选择</label>
              <button
                onClick={() => setIsManualMode(!isManualMode)}
                className="text-[10px] font-black uppercase text-primary-600 hover:underline tracking-widest"
              >
                {isManualMode ? '返回预设模式' : '切换手动自由输入'}
              </button>
            </div>
            {!isManualMode && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => handlePresetChange(key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                      selectedPreset === key
                        ? 'border-primary-300 bg-primary-50 text-primary-700 ring-2 ring-primary-100'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
            {isManualMode && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-bold">
                手动模式：你可以自由输入任何 Provider、Base URL 和模型 ID。
              </div>
            )}
          </div>

          {/* Name + Provider */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="模型名称"
              placeholder="e.g. GPT-4o"
              value={form.name}
              onChange={v => updateField('name', v)}
              error={validation.name}
              required
            />
            <FormField
              label="Provider"
              placeholder="e.g. openai"
              value={form.provider}
              onChange={v => updateField('provider', v)}
              error={validation.provider}
              required
            />
          </div>

          {/* Model ID */}
          <FormField
            label="Model ID"
            placeholder="e.g. gpt-4o-2024-08-06"
            value={form.modelId}
            onChange={v => updateField('modelId', v)}
            error={validation.modelId}
            required
            mono
          />

          {/* Base URL */}
          <FormField
            label="Base URL"
            placeholder="e.g. https://api.openai.com/v1"
            value={form.baseUrl}
            onChange={v => updateField('baseUrl', v)}
            error={validation.baseUrl}
            required
            mono
          />

          {/* API Key */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">API Key <span className="text-slate-300">(可选，项目级可覆盖)</span></label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-mono font-bold text-slate-700 transition-all pr-12"
                placeholder="sk-..."
                value={form.apiKey}
                onChange={e => updateField('apiKey', e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-600 transition"
                title={showApiKey ? '隐藏' : '显示'}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Temperature + MaxTokens */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Temperature</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={form.temperature}
                  onChange={e => updateField('temperature', parseFloat(e.target.value))}
                  className="flex-1 accent-primary-600 h-2"
                />
                <span className="text-sm font-bold text-slate-700 min-w-[2.5rem] text-right tabular-nums">{form.temperature.toFixed(1)}</span>
              </div>
              {validation.temperature && <p className="text-[10px] text-rose-500 font-bold ml-1">{validation.temperature}</p>}
            </div>
            <FormField
              label="Max Tokens"
              placeholder="4096"
              value={String(form.maxTokens)}
              onChange={v => updateField('maxTokens', parseInt(v) || 0)}
              error={validation.maxTokens}
              type="number"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-2xl bg-rose-50 border border-rose-100">
              <AlertCircle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-700 font-bold">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-6 bg-slate-50/50 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 font-medium hidden sm:block">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-[9px] font-mono font-bold">Ctrl+Enter</kbd> 快捷提交
          </p>
          <div className="flex items-center gap-3 ml-auto">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>取消</Button>
            <Button
              icon={submitting ? Loader2 : Check}
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              className={submitting ? '[&_svg]:animate-spin' : ''}
            >
              {submitting ? '添加中...' : '确认添加'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────── 通用表单字段 ─────────
function FormField({
  label,
  placeholder,
  value,
  onChange,
  error,
  required,
  mono,
  type = 'text',
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  required?: boolean;
  mono?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">
        {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        className={`w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold text-slate-700 transition-all ${
          mono ? 'font-mono' : ''
        } ${error ? 'ring-2 ring-rose-200' : ''}`}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {error && <p className="text-[10px] text-rose-500 font-bold ml-1">{error}</p>}
    </div>
  );
}
