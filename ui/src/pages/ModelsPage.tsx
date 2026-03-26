import { useState, useEffect, useCallback, useMemo } from 'react';
import { Cpu, Plus, Trash2, Search, Server, X, Check, AlertCircle, Loader2, Eye, EyeOff, ChevronDown, ChevronRight, ScanLine, Keyboard, Globe } from 'lucide-react';
import { Card, Button, Badge } from '../components/ui';

// ───────── 类型定义 ─────────
interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
}

interface RemoteModel {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
  [key: string]: any;
}

interface AddModelForm {
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
}

const EMPTY_FORM: AddModelForm = {
  name: '',
  provider: '',
  baseUrl: '',
  apiKey: '',
  modelId: '',
  temperature: 0.7,
  maxTokens: 4096,
};

const PROVIDER_PRESETS: Record<string, { baseUrl: string; label: string; color: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', label: 'OpenAI', color: 'bg-emerald-50 text-emerald-700' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', label: 'Anthropic', color: 'bg-amber-50 text-amber-700' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', label: 'DeepSeek', color: 'bg-blue-50 text-blue-700' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', label: 'Google', color: 'bg-rose-50 text-rose-700' },
  custom: { baseUrl: '', label: '自定义', color: 'bg-slate-100 text-slate-600' },
};

// ───────── 主页面 ─────────
export function ModelsPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/v1/models');
      const data = await res.json();
      setModels(data);
    } catch (err) {
      console.error('获取模型列表失败', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const grouped = useMemo(() => {
    const filtered = searchQuery.trim()
      ? models.filter(m =>
          m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.modelId.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.provider.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : models;

    const map = new Map<string, ModelConfig[]>();
    for (const m of filtered) {
      const key = m.provider || 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [models, searchQuery]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个模型配置吗？')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`http://localhost:3001/api/v1/models/${id}`, { method: 'DELETE' });
      if (res.ok) setModels(await res.json());
    } catch (err) { alert('删除失败'); }
    finally { setDeletingId(null); }
  };

  const toggleProvider = (provider: string) => {
    setCollapsedProviders(prev => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const handleModelAdded = (updatedModels: ModelConfig[]) => {
    setModels(updatedModels);
    setShowDialog(false);
  };

  const handleBatchDone = (updatedModels: ModelConfig[]) => {
    setModels(updatedModels);
    setShowBatchDialog(false);
  };

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center gap-3 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="font-bold animate-pulse">加载模型列表...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-slate-900 rounded-2xl shadow-xl">
            <Cpu className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight italic">模型管理</h1>
            <p className="text-sm text-slate-500 font-medium">管理全局 LLM 模型配置，支持多 Provider 多模型</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" icon={Plus} onClick={() => setShowDialog(true)}>手动添加模型</Button>
          <Button icon={Plus} onClick={() => setShowBatchDialog(true)}>批量导入模型</Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2 rounded-2xl bg-white border border-slate-200 px-4 py-3 shadow-sm focus-within:ring-4 focus-within:ring-primary-50 transition-all">
        <Search className="h-4 w-4 text-slate-400 shrink-0" />
        <input
          type="text"
          className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-slate-400"
          placeholder="搜索模型名称、Model ID 或 Provider..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600 transition">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 text-xs font-black uppercase tracking-widest text-slate-400">
        <span>{models.length} 个模型</span>
        <span>{grouped.size} 个 Provider</span>
      </div>

      {/* Model list */}
      {grouped.size === 0 ? (
        <Card className="p-12 text-center" hover={false}>
          <Server className="h-10 w-10 text-slate-300 mx-auto mb-4" />
          <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-2">
            {searchQuery ? '没有匹配的模型' : '暂未配置模型'}
          </h3>
          <p className="text-xs text-slate-400 font-medium mb-6">
            {searchQuery ? '尝试修改搜索关键字' : '点击「手动添加模型」配置你的第一个 LLM'}
          </p>
          {!searchQuery && <Button icon={Plus} onClick={() => setShowDialog(true)} size="sm">添加模型</Button>}
        </Card>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([provider, items]) => {
            const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
            const isCollapsed = collapsedProviders.has(provider);
            return (
              <Card key={provider} className="p-0 overflow-hidden" hover={false}>
                <button
                  onClick={() => toggleProvider(provider)}
                  className="w-full flex items-center justify-between px-6 py-4 bg-slate-50/50 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                    <Badge status="default" className={preset.color}>{preset.label || provider}</Badge>
                    <span className="text-xs font-bold text-slate-400">{items.length} 个模型</span>
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="divide-y divide-slate-100">
                    {items.map(model => (
                      <div key={model.id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 transition-colors group">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3 mb-1.5">
                            <span className="text-sm font-bold text-slate-800">{model.name}</span>
                            <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg max-w-[220px] truncate">{model.modelId}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-slate-400 font-medium">
                            <span className="flex items-center gap-1 max-w-[300px] truncate">
                              <Server className="h-3 w-3 shrink-0" />
                              <span className="font-mono">{model.baseUrl}</span>
                            </span>
                            <span className="shrink-0">T={model.temperature}</span>
                            <span className="shrink-0">Max={model.maxTokens.toLocaleString()}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDelete(model.id)}
                          disabled={deletingId === model.id}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-xl hover:bg-rose-50 text-slate-400 hover:text-rose-600 disabled:opacity-50"
                        >
                          {deletingId === model.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 手动添加弹窗 */}
      {showDialog && (
        <AddModelDialog onClose={() => setShowDialog(false)} onSuccess={handleModelAdded} />
      )}

      {/* 批量导入弹窗 */}
      {showBatchDialog && (
        <BatchImportDialog onClose={() => setShowBatchDialog(false)} onSuccess={handleBatchDone} />
      )}
    </div>
  );
}

// ───────── 批量导入弹窗 ─────────
function BatchImportDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (models: ModelConfig[]) => void }) {
  const [tab, setTab] = useState<'scan' | 'manual'>('scan');

  // 扫描模式状态
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  // 手动模式状态
  const [manualForm, setManualForm] = useState<AddModelForm>({ ...EMPTY_FORM });
  const [manualEntries, setManualEntries] = useState<AddModelForm[]>([{ ...EMPTY_FORM }]);
  const [manualError, setManualError] = useState('');

  const handleScan = async () => {
    if (!baseUrl.trim()) { setScanError('请输入 Base URL'); return; }
    setScanning(true);
    setScanError('');
    setRemoteModels([]);
    setSelectedRemote(new Set());
    try {
      const res = await fetch('http://localhost:3001/api/v1/models/fetch-remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `错误 (${res.status})`);
      setRemoteModels(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setScanError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const toggleRemote = (id: string) => {
    setSelectedRemote(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllRemote = () => {
    if (selectedRemote.size === remoteModels.length) {
      setSelectedRemote(new Set());
    } else {
      setSelectedRemote(new Set(remoteModels.map(m => m.id)));
    }
  };

  const handleImportRemote = async () => {
    if (selectedRemote.size === 0) return;
    setImporting(true);
    setImportedCount(0);
    try {
      const toImport = remoteModels.filter(m => selectedRemote.has(m.id));
      const res = await fetch('http://localhost:3001/api/v1/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toImport.map(m => ({
          id: `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: m.id || m.name || m.id,
          provider: inferProvider(baseUrl),
          baseUrl: baseUrl.trim().replace(/\/$/, ''),
          apiKey: apiKey.trim(),
          modelId: m.id,
          temperature: 0.7,
          maxTokens: 4096,
        }))),
      });
      if (!res.ok) throw new Error('导入失败');
      const allModels = await res.json();
      setImportedCount(selectedRemote.size);
      setTimeout(() => { onSuccess(allModels); }, 1200);
    } catch (err: any) {
      setScanError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const addManualEntry = () => {
    setManualEntries(prev => [...prev, { ...EMPTY_FORM }]);
  };

  const removeManualEntry = (idx: number) => {
    setManualEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const updateManualEntry = (idx: number, field: keyof AddModelForm, value: any) => {
    setManualEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const handleImportManual = async () => {
    const validEntries = manualEntries.filter(e => e.name.trim() && e.modelId.trim() && e.baseUrl.trim());
    if (validEntries.length === 0) { setManualError('至少需要填写一组完整的模型信息'); return; }
    setImporting(true);
    setManualError('');
    try {
      const res = await fetch('http://localhost:3001/api/v1/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validEntries.map((e, i) => ({
          id: `manual-${Date.now()}-${i}`,
          name: e.name.trim(),
          provider: e.provider.trim() || 'custom',
          baseUrl: e.baseUrl.trim(),
          apiKey: e.apiKey.trim(),
          modelId: e.modelId.trim(),
          temperature: e.temperature,
          maxTokens: e.maxTokens,
        }))),
      });
      if (!res.ok) throw new Error('导入失败');
      const allModels = await res.json();
      setImportedCount(validEntries.length);
      setTimeout(() => { onSuccess(allModels); }, 1200);
    } catch (err: any) {
      setManualError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const inferProvider = (url: string): string => {
    const lower = url.toLowerCase();
    if (lower.includes('openai')) return 'openai';
    if (lower.includes('anthropic')) return 'anthropic';
    if (lower.includes('deepseek')) return 'deepseek';
    if (lower.includes('google') || lower.includes('gemini')) return 'google';
    return 'custom';
  };

  // 键盘 ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 rounded-xl">
              <Globe className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">批量导入模型</h2>
              <p className="text-xs text-slate-400 font-medium mt-0.5">扫描远程可用模型，或手动输入模型信息</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="px-8 flex-shrink-0">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl w-fit">
            <button
              onClick={() => setTab('scan')}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'scan' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <ScanLine className="h-4 w-4" />扫描可用模型
            </button>
            <button
              onClick={() => setTab('manual')}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'manual' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Keyboard className="h-4 w-4" />手动输入添加
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {tab === 'scan' ? (
            <>
              {/* Base URL + API Key */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Base URL <span className="text-rose-400">*</span></label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-indigo-50 text-sm font-mono font-bold text-slate-700 transition-all"
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleScan()}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">API Key <span className="text-slate-300">(可选)</span></label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-indigo-50 text-sm font-mono font-bold text-slate-700 transition-all pr-12"
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      autoComplete="off"
                    />
                    <button type="button" onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-600 transition">
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button onClick={handleScan} disabled={scanning || !baseUrl.trim()} icon={scanning ? Loader2 : ScanLine}
                  className={`w-full py-3 ${scanning ? '[&_svg]:animate-spin' : ''}`}>
                  {scanning ? '正在扫描...' : '扫描可用模型'}
                </Button>
              </div>

              {/* Error */}
              {scanError && (
                <div className="flex items-start gap-2 p-3 rounded-2xl bg-rose-50 border border-rose-100">
                  <AlertCircle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-rose-700 font-bold break-all">{scanError}</p>
                </div>
              )}

              {/* 扫描结果 */}
              {remoteModels.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">
                      找到 {remoteModels.length} 个模型
                    </p>
                    <button onClick={selectAllRemote}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 transition px-2 py-1 rounded-lg hover:bg-indigo-50">
                      {selectedRemote.size === remoteModels.length ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-100 rounded-2xl p-3">
                    {remoteModels.map(m => (
                      <label key={m.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${selectedRemote.has(m.id) ? 'bg-indigo-50 border border-indigo-100' : 'hover:bg-slate-50'}`}>
                        <input type="checkbox" checked={selectedRemote.has(m.id)} onChange={() => toggleRemote(m.id)}
                          className="h-4 w-4 rounded accent-indigo-600" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800 truncate">{m.id}</p>
                          {m.owned_by && <p className="text-[10px] text-slate-400 font-mono truncate">{m.owned_by}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                  <Button
                    onClick={handleImportRemote}
                    disabled={selectedRemote.size === 0 || importing}
                    icon={importing ? Loader2 : Check}
                    className={`w-full py-3 ${importing ? '[&_svg]:animate-spin' : ''}`}
                  >
                    {importing ? '导入中...' : (importedCount > 0 ? `已导入 ${importedCount} 个模型` : `导入选中的 ${selectedRemote.size} 个模型`)}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* 手动输入 */}
              <div className="space-y-4">
                {manualEntries.map((entry, idx) => (
                  <div key={idx} className="relative p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                    {manualEntries.length > 1 && (
                      <button onClick={() => removeManualEntry(idx)}
                        className="absolute top-3 right-3 p-1.5 rounded-xl hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">
                          模型名称 <span className="text-rose-400">*</span>
                        </label>
                        <input type="text" className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-primary-50 text-sm font-bold transition-all"
                          placeholder="GPT-4o" value={entry.name} onChange={e => updateManualEntry(idx, 'name', e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">
                          模型 ID <span className="text-rose-400">*</span>
                        </label>
                        <input type="text" className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-primary-50 text-sm font-mono font-bold transition-all"
                          placeholder="gpt-4o-2024-08-06" value={entry.modelId} onChange={e => updateManualEntry(idx, 'modelId', e.target.value)} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Base URL <span className="text-rose-400">*</span></label>
                        <input type="text" className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-primary-50 text-sm font-mono font-bold transition-all"
                          placeholder="https://api.openai.com/v1" value={entry.baseUrl} onChange={e => updateManualEntry(idx, 'baseUrl', e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Provider</label>
                        <input type="text" className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-primary-50 text-sm font-bold transition-all"
                          placeholder="openai" value={entry.provider} onChange={e => updateManualEntry(idx, 'provider', e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">API Key <span className="text-slate-300">(可选)</span></label>
                      <input type="password" className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-primary-50 text-sm font-mono font-bold transition-all"
                        placeholder="sk-..." value={entry.apiKey} onChange={e => updateManualEntry(idx, 'apiKey', e.target.value)} />
                    </div>
                  </div>
                ))}

                <Button variant="outline" icon={Plus} onClick={addManualEntry} className="w-full py-3">
                  再加一个模型
                </Button>
              </div>

              {/* Error */}
              {manualError && (
                <div className="flex items-start gap-2 p-3 rounded-2xl bg-rose-50 border border-rose-100">
                  <AlertCircle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-rose-700 font-bold">{manualError}</p>
                </div>
              )}

              <Button
                onClick={handleImportManual}
                disabled={importing}
                icon={importing ? Loader2 : Check}
                className={`w-full py-3 ${importing ? '[&_svg]:animate-spin' : ''}`}
              >
                {importing ? '导入中...' : (importedCount > 0 ? `已导入 ${importedCount} 个模型` : `确认导入 ${manualEntries.filter(e => e.name.trim() && e.modelId.trim() && e.baseUrl.trim()).length} 个模型`)}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────── 手动添加弹窗（单模型）────────
function AddModelDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (models: ModelConfig[]) => void }) {
  const [form, setForm] = useState<AddModelForm>({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  const validation = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = '请输入模型名称';
    if (!form.provider.trim()) errors.provider = '请输入 Provider';
    if (!form.modelId.trim()) errors.modelId = '请输入 Model ID';
    if (!form.baseUrl.trim()) errors.baseUrl = '请输入 Base URL';
    if (form.temperature < 0 || form.temperature > 2) errors.temperature = 'Temperature 范围 0~2';
    if (form.maxTokens < 1) errors.maxTokens = 'Max Tokens 必须大于 0';
    return errors;
  }, [form]);

  const isValid = Object.keys(validation).length === 0;

  const handlePresetChange = (presetKey: string) => {
    setSelectedPreset(presetKey);
    const preset = PROVIDER_PRESETS[presetKey];
    if (preset) {
      setForm(prev => ({
        ...prev,
        provider: presetKey === 'custom' ? prev.provider : presetKey,
        baseUrl: preset.baseUrl || prev.baseUrl,
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
      const data = await res.json();
      onSuccess(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || '添加模型失败');
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = <K extends keyof AddModelForm>(key: K, value: AddModelForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setError('');
  };

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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
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
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-8 pb-2 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Provider Presets */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Provider 快捷选择</label>
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
                  type="range" min="0" max="2" step="0.1"
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
  label, placeholder, value, onChange, error, required, mono, type = 'text',
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  error?: string; required?: boolean; mono?: boolean; type?: string;
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
