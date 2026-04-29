import { useState, useEffect, useCallback, useMemo } from 'react';
import { Cpu, Plus, Trash2, Search, Server, X, Check, AlertCircle, Loader2, Eye, EyeOff, ChevronDown, ChevronRight, ScanLine, Keyboard, Globe, ChevronUp, Sparkles, Settings, Network } from 'lucide-react';
import { Card, Button, Badge } from '../components/ui';

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
  name: '', provider: '', baseUrl: '', apiKey: '', modelId: '',
  temperature: 0.7, maxTokens: 4096,
};

const PROVIDER_PRESETS: Record<string, { baseUrl: string; label: string; gradient: string; icon: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', label: 'OpenAI', gradient: 'from-emerald-500 to-teal-500', icon: 'O' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', label: 'Anthropic', gradient: 'from-orange-500 to-amber-500', icon: 'A' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', label: 'DeepSeek', gradient: 'from-blue-500 to-indigo-500', icon: 'D' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', label: 'Google', gradient: 'from-rose-500 to-pink-500', icon: 'G' },
  custom: { baseUrl: '', label: '自定义', gradient: 'from-slate-500 to-slate-600', icon: 'C' },
};

export function ModelsPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/v1/models');
      const data = await res.json();
      setModels(data);
    } catch (err) { console.error('获取模型列表失败', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchModels(); setTimeout(() => setMounted(true), 100); }, [fetchModels]);

  const grouped = useMemo(() => {
    const filtered = searchQuery.trim()
      ? models.filter(m =>
          m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.modelId.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.provider.toLowerCase().includes(searchQuery.toLowerCase()))
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
      next.has(provider) ? next.delete(provider) : next.add(provider);
      return next;
    });
  };

  if (loading) return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-violet-50/30" />
      <div className="absolute inset-0">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="absolute h-px bg-gradient-to-r from-transparent via-violet-200/40 to-transparent"
            style={{ top: `${15 + i * 15}%`, animation: `scanline 3s ease-in-out ${i * 0.2}s infinite` }} />
        ))}
      </div>
      <div className="relative flex items-center justify-center h-[70vh]">
        <div className="text-center space-y-4">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 animate-pulse opacity-20" />
            <div className="absolute inset-2 rounded-xl bg-white shadow-lg shadow-violet-500/20 flex items-center justify-center">
              <Cpu className="w-8 h-8 text-violet-500 animate-pulse" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-500 tracking-wide">加载模型列表...</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen w-full overflow-hidden pb-20">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-violet-50/40" />
      <div className="absolute inset-0 opacity-[0.015]" 
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #4c1d95 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-violet-100/50 to-purple-100/30 blur-3xl transform translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-20 left-0 w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-fuchsia-100/40 to-pink-100/20 blur-3xl transform -translate-x-1/2" />

      <div className={`relative pt-12 px-8 pb-8 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-10">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-50 text-violet-600 text-xs font-bold tracking-wide">
                <Settings className="w-3.5 h-3.5" />全局配置
              </div>
              <h1 className="text-5xl font-black tracking-tight text-slate-900">
                <span className="bg-gradient-to-r from-slate-900 via-violet-900 to-slate-900 bg-clip-text">模型管理</span>
              </h1>
              <p className="text-base text-slate-500 font-medium max-w-xl leading-relaxed">
                配置 LLM 连接参数：支持 OpenAI、Anthropic、DeepSeek 等主流模型服务商
              </p>
            </div>
            
            <div className="flex flex-wrap gap-4 items-center">
              {/* 搜索框 */}
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-violet-500 to-purple-500 rounded-2xl opacity-0 group-focus-within:opacity-100 transition duration-300" />
                <div className="relative flex items-center bg-white rounded-2xl border border-slate-200/80 shadow-sm">
                  <Search className="w-4 h-4 text-slate-400 ml-4" />
                  <input placeholder="搜索模型..." 
                    className="w-56 px-4 py-3 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="mr-3 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              
              {/* 模型数量 */}
              <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white border border-slate-200/60 shadow-sm">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
                <span className="text-sm font-semibold text-slate-700">{models.length} 个模型</span>
              </div>
              
              {/* Provider 数量 */}
              <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white border border-slate-200/60 shadow-sm">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                <span className="text-sm font-semibold text-slate-700">{grouped.size} 个 Provider</span>
              </div>
              
              {/* 批量导入 */}
              <button onClick={() => setShowBatchDialog(true)}
                className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-bold text-sm shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0">
                <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                <Network className="w-4 h-4 relative" /><span className="relative">批量导入</span>
              </button>
              
              {/* 添加模型 */}
              <button onClick={() => setShowDialog(true)}
                className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white font-bold text-sm shadow-lg shadow-fuchsia-500/25 hover:shadow-xl hover:shadow-fuchsia-500/30 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0">
                <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-pink-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                <Plus className="w-4 h-4 relative" /><span className="relative">添加模型</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`relative px-8 max-w-7xl mx-auto transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        {grouped.size === 0 ? (
          <div className="text-center py-20 rounded-3xl bg-gradient-to-br from-slate-50/80 to-white border border-slate-200/50">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100" />
              <div className="absolute inset-0 rounded-2xl bg-white shadow-lg flex items-center justify-center">
                <Server className="w-10 h-10 text-slate-300" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-600 mb-2">{searchQuery ? '没有匹配的模型' : '暂未配置模型'}</h3>
            <p className="text-sm text-slate-400 mb-6">{searchQuery ? '尝试修改搜索关键字' : '点击「添加模型」配置你的第一个 LLM'}</p>
            {!searchQuery && (
              <button onClick={() => setShowDialog(true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-bold text-sm shadow-lg shadow-violet-500/25 hover:shadow-xl transition-all">
                <Plus className="w-4 h-4" />添加模型
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([provider, items]) => {
              const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
              const isCollapsed = collapsedProviders.has(provider);
              return (
                <div key={provider} className="rounded-3xl overflow-hidden border border-slate-200/60 bg-white shadow-sm">
                  <button onClick={() => toggleProvider(provider)}
                    className="w-full flex items-center justify-between px-6 py-5 bg-gradient-to-r from-slate-50/80 to-white hover:from-slate-50 hover:to-slate-50 transition-all">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${preset.gradient} flex items-center justify-center text-white font-black text-sm shadow-lg`}>
                        {preset.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-bold text-slate-900">{preset.label || provider}</span>
                          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold">{items.length} 个模型</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 font-mono">{items[0]?.baseUrl}</p>
                      </div>
                    </div>
                    {isCollapsed ? <ChevronRight className="w-5 h-5 text-slate-400" /> : <ChevronUp className="w-5 h-5 text-slate-400" />}
                  </button>
                  
                  {!isCollapsed && (
                    <div className="divide-y divide-slate-100">
                      {items.map((model, idx) => (
                        <div key={model.id} 
                          className="flex items-center justify-between px-6 py-5 hover:bg-gradient-to-r hover:from-violet-50/30 hover:to-purple-50/20 transition-all group">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-base font-bold text-slate-800">{model.name}</span>
                              <span className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-600 text-xs font-mono font-semibold max-w-[200px] truncate">
                                {model.modelId}
                              </span>
                            </div>
                            <div className="flex items-center gap-6 text-xs text-slate-400">
                              <span className="flex items-center gap-1.5 max-w-[280px] truncate">
                                <Server className="h-3 w-3 shrink-0 text-slate-300" />
                                <span className="font-mono">{model.baseUrl}</span>
                              </span>
                              <span className="shrink-0 px-2 py-1 rounded-md bg-slate-100 font-mono">T={typeof model.temperature === 'number' ? model.temperature.toFixed(1) : '0.7'}</span>
                              <span className="shrink-0 px-2 py-1 rounded-md bg-slate-100 font-mono">Max={typeof model.maxTokens === 'number' ? model.maxTokens.toLocaleString() : '4096'}</span>
                            </div>
                          </div>
                          <button onClick={() => handleDelete(model.id)} disabled={deletingId === model.id}
                            className="ml-4 p-3 rounded-xl opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-50 text-slate-300 hover:text-rose-600 disabled:opacity-50">
                            {deletingId === model.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showDialog && <AddModelDialog onClose={() => setShowDialog(false)} onSuccess={(m) => { setModels(m); setShowDialog(false); }} />}
      {showBatchDialog && <BatchImportDialog onClose={() => setShowBatchDialog(false)} onSuccess={(m) => { setModels(m); setShowBatchDialog(false); }} />}

      <style>{`
        @keyframes scanline {
          0%, 100% { opacity: 0.3; transform: translateX(-100%); }
          50% { opacity: 0.6; transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

function BatchImportDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (models: ModelConfig[]) => void }) {
  const [tab, setTab] = useState<'scan' | 'manual'>('scan');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [manualEntries, setManualEntries] = useState<AddModelForm[]>([{ ...EMPTY_FORM }]);
  const [manualError, setManualError] = useState('');

  const handleScan = async () => {
    if (!baseUrl.trim()) { setScanError('请输入 Base URL'); return; }
    setScanning(true); setScanError(''); setRemoteModels([]); setSelectedRemote(new Set());
    try {
      const res = await fetch('http://localhost:3001/api/v1/models/fetch-remote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `错误 (${res.status})`);
      setRemoteModels(Array.isArray(data) ? data : []);
    } catch (err: any) { setScanError(err.message); }
    finally { setScanning(false); }
  };

  const toggleRemote = (id: string) => {
    setSelectedRemote(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllRemote = () => {
    if (selectedRemote.size === remoteModels.length) setSelectedRemote(new Set());
    else setSelectedRemote(new Set(remoteModels.map(m => m.id)));
  };

  const handleImportRemote = async () => {
    if (selectedRemote.size === 0) return;
    setImporting(true); setImportedCount(0);
    try {
      const toImport = remoteModels.filter(m => selectedRemote.has(m.id));
      const res = await fetch('http://localhost:3001/api/v1/models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toImport.map(m => ({
          id: `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: m.id || m.name, provider: inferProvider(baseUrl),
          baseUrl: baseUrl.trim().replace(/\/$/, ''), apiKey: apiKey.trim(),
          modelId: m.id, temperature: 0.7, maxTokens: 4096,
        }))),
      });
      if (!res.ok) throw new Error('导入失败');
      const allModels = await res.json();
      setImportedCount(selectedRemote.size);
      setTimeout(() => { onSuccess(allModels); }, 1200);
    } catch (err: any) { setScanError(err.message); }
    finally { setImporting(false); }
  };

  const addManualEntry = () => setManualEntries(prev => [...prev, { ...EMPTY_FORM }]);
  const removeManualEntry = (idx: number) => setManualEntries(prev => prev.filter((_, i) => i !== idx));
  const updateManualEntry = (idx: number, field: keyof AddModelForm, value: any) => {
    setManualEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const handleImportManual = async () => {
    const validEntries = manualEntries.filter(e => e.name.trim() && e.modelId.trim() && e.baseUrl.trim());
    if (validEntries.length === 0) { setManualError('至少需要填写一组完整的模型信息'); return; }
    setImporting(true); setManualError('');
    try {
      const res = await fetch('http://localhost:3001/api/v1/models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validEntries.map((e, i) => ({
          id: `manual-${Date.now()}-${i}`, name: e.name.trim(),
          provider: e.provider.trim() || 'custom', baseUrl: e.baseUrl.trim(),
          apiKey: e.apiKey.trim(), modelId: e.modelId.trim(),
          temperature: e.temperature, maxTokens: e.maxTokens,
        }))),
      });
      if (!res.ok) throw new Error('导入失败');
      const allModels = await res.json();
      setImportedCount(validEntries.length);
      setTimeout(() => { onSuccess(allModels); }, 1200);
    } catch (err: any) { setManualError(err.message); }
    finally { setImporting(false); }
  };

  const inferProvider = (url: string): string => {
    const lower = url.toLowerCase();
    if (lower.includes('openai')) return 'openai';
    if (lower.includes('anthropic')) return 'anthropic';
    if (lower.includes('deepseek')) return 'deepseek';
    if (lower.includes('google') || lower.includes('gemini')) return 'google';
    return 'custom';
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-violet-50 to-purple-50 border-b border-violet-100">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-violet-200/30 to-purple-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 shadow-lg shadow-violet-500/25">
                <Globe className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">批量导入模型</h2>
                <p className="text-sm text-slate-500 mt-0.5">扫描远程可用模型，或手动输入模型信息</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-8 pt-6">
          <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl w-fit">
            <button onClick={() => setTab('scan')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                tab === 'scan' ? 'bg-white shadow text-violet-700' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <ScanLine className="w-4 h-4" />扫描模型
            </button>
            <button onClick={() => setTab('manual')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                tab === 'manual' ? 'bg-white shadow text-violet-700' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <Keyboard className="w-4 h-4" />手动输入
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {tab === 'scan' ? (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Base URL <span className="text-rose-500">*</span></label>
                  <input type="text"
                    className="w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-violet-400 focus:ring-4 focus:ring-violet-50 outline-none transition-all text-sm font-mono font-semibold"
                    placeholder="https://api.openai.com/v1" value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleScan()} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Key <span className="text-slate-300">(可选)</span></label>
                  <div className="relative">
                    <input type={showApiKey ? 'text' : 'password'}
                      className="w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-violet-400 focus:ring-4 focus:ring-violet-50 outline-none transition-all text-sm font-mono font-semibold pr-12"
                      placeholder="sk-..." value={apiKey}
                      onChange={e => setApiKey(e.target.value)} autoComplete="off" />
                    <button type="button" onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition">
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <button onClick={handleScan} disabled={scanning || !baseUrl.trim()}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-bold text-sm shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                  {scanning ? <><Loader2 className="w-4 h-4 animate-spin" />正在扫描...</> : <><ScanLine className="w-4 h-4" />扫描可用模型</>}
                </button>
              </div>

              {scanError && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-100">
                  <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-rose-700 font-semibold break-all">{scanError}</p>
                </div>
              )}

              {remoteModels.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">找到 {remoteModels.length} 个模型</p>
                    <button onClick={selectAllRemote}
                      className="text-xs font-bold text-violet-600 hover:text-violet-800 transition px-3 py-1.5 rounded-lg hover:bg-violet-50">
                      {selectedRemote.size === remoteModels.length ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-200 rounded-xl p-3 bg-slate-50/50">
                    {remoteModels.map(m => (
                      <label key={m.id} className={`flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all ${
                        selectedRemote.has(m.id) ? 'bg-violet-50 border border-violet-200' : 'hover:bg-white'
                      }`}>
                        <input type="checkbox" checked={selectedRemote.has(m.id)} onChange={() => toggleRemote(m.id)}
                          className="h-4 w-4 rounded accent-violet-600" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800 truncate">{m.id}</p>
                          {m.owned_by && <p className="text-xs text-slate-400 font-mono truncate">{m.owned_by}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                  <button onClick={handleImportRemote} disabled={selectedRemote.size === 0 || importing}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-bold text-sm shadow-lg shadow-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                    {importing ? <><Loader2 className="w-4 h-4 animate-spin" />导入中...</> :
                     importedCount > 0 ? <><Check className="w-4 h-4" />已导入 {importedCount} 个模型</> :
                     <><Check className="w-4 h-4" />导入选中的 {selectedRemote.size} 个模型</>}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-4">
                {manualEntries.map((entry, idx) => (
                  <div key={idx} className="relative p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                    {manualEntries.length > 1 && (
                      <button onClick={() => removeManualEntry(idx)}
                        className="absolute top-3 right-3 p-2 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模型名称 <span className="text-rose-500">*</span></label>
                        <input type="text"
                          className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-50 outline-none text-sm font-semibold transition-all"
                          placeholder="GPT-4o" value={entry.name} onChange={e => updateManualEntry(idx, 'name', e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模型 ID <span className="text-rose-500">*</span></label>
                        <input type="text"
                          className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-50 outline-none text-sm font-mono font-semibold transition-all"
                          placeholder="gpt-4o-2024-08-06" value={entry.modelId} onChange={e => updateManualEntry(idx, 'modelId', e.target.value)} />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Base URL <span className="text-rose-500">*</span></label>
                        <input type="text"
                          className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-50 outline-none text-sm font-mono font-semibold transition-all"
                          placeholder="https://api.openai.com/v1" value={entry.baseUrl} onChange={e => updateManualEntry(idx, 'baseUrl', e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Provider</label>
                        <input type="text"
                          className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-50 outline-none text-sm font-semibold transition-all"
                          placeholder="openai" value={entry.provider} onChange={e => updateManualEntry(idx, 'provider', e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Key <span className="text-slate-300">(可选)</span></label>
                      <input type="password"
                        className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-50 outline-none text-sm font-mono font-semibold transition-all"
                        placeholder="sk-..." value={entry.apiKey} onChange={e => updateManualEntry(idx, 'apiKey', e.target.value)} />
                    </div>
                  </div>
                ))}
                <button onClick={addManualEntry}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 font-bold text-sm hover:border-violet-300 hover:text-violet-600 transition-all flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" />再加一个模型
                </button>
              </div>

              {manualError && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-100">
                  <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-rose-700 font-semibold">{manualError}</p>
                </div>
              )}

              <button onClick={handleImportManual} disabled={importing}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-bold text-sm shadow-lg shadow-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                {importing ? <><Loader2 className="w-4 h-4 animate-spin" />导入中...</> :
                 importedCount > 0 ? <><Check className="w-4 h-4" />已导入 {importedCount} 个模型</> :
                 <><Check className="w-4 h-4" />确认导入 {manualEntries.filter(e => e.name.trim() && e.modelId.trim() && e.baseUrl.trim()).length} 个模型</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
    setSubmitting(true); setError('');
    try {
      const res = await fetch('http://localhost:3001/api/v1/models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `manual-${Date.now()}`, name: form.name.trim(), provider: form.provider.trim(),
          baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim(), modelId: form.modelId.trim(),
          temperature: form.temperature, maxTokens: form.maxTokens,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '添加失败');
      }
      const data = await res.json();
      onSuccess(Array.isArray(data) ? data : []);
    } catch (err: any) { setError(err.message || '添加模型失败'); }
    finally { setSubmitting(false); }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-fuchsia-50 to-pink-50 border-b border-fuchsia-100">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-fuchsia-200/30 to-pink-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-pink-500 shadow-lg shadow-fuchsia-500/25">
                <Plus className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">添加模型</h2>
                <p className="text-sm text-slate-500 mt-0.5">配置 LLM 的连接参数</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-8 py-6 space-y-5 max-h-[60vh] overflow-y-auto">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Provider 快捷选择</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                <button key={key} onClick={() => handlePresetChange(key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                    selectedPreset === key
                      ? 'border-violet-300 bg-violet-50 text-violet-700 ring-2 ring-violet-100'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="模型名称" placeholder="e.g. GPT-4o" value={form.name}
              onChange={v => updateField('name', v)} error={validation.name} required />
            <FormField label="Provider" placeholder="e.g. openai" value={form.provider}
              onChange={v => updateField('provider', v)} error={validation.provider} required />
          </div>

          <FormField label="Model ID" placeholder="e.g. gpt-4o-2024-08-06" value={form.modelId}
            onChange={v => updateField('modelId', v)} error={validation.modelId} required mono />

          <FormField label="Base URL" placeholder="e.g. https://api.openai.com/v1" value={form.baseUrl}
            onChange={v => updateField('baseUrl', v)} error={validation.baseUrl} required mono />

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Key <span className="text-slate-300">(可选，项目级可覆盖)</span></label>
            <div className="relative">
              <input type={showApiKey ? 'text' : 'password'}
                className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-violet-400 focus:ring-4 focus:ring-violet-50 outline-none transition-all text-sm font-mono font-semibold pr-12"
                placeholder="sk-..." value={form.apiKey} onChange={e => updateField('apiKey', e.target.value)} autoComplete="off" />
              <button type="button" onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition">
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Temperature</label>
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="2" step="0.1" value={form.temperature}
                  onChange={e => updateField('temperature', parseFloat(e.target.value))}
                  className="flex-1 accent-violet-600 h-2" />
                <span className="text-sm font-bold text-slate-700 min-w-[2.5rem] text-right tabular-nums">{form.temperature.toFixed(1)}</span>
              </div>
              {validation.temperature && <p className="text-xs text-rose-500 font-bold">{validation.temperature}</p>}
            </div>
            <FormField label="Max Tokens" placeholder="4096" value={String(form.maxTokens)}
              onChange={v => updateField('maxTokens', parseInt(v) || 0)} error={validation.maxTokens} type="number" />
          </div>

          {error && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-100">
              <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-700 font-semibold">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-8 py-6 bg-gradient-to-r from-slate-50 to-white border-t border-slate-100">
          <p className="text-xs text-slate-400 font-medium hidden sm:block">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-[9px] font-mono font-bold">Ctrl+Enter</kbd> 快捷提交
          </p>
          <div className="flex items-center gap-3 ml-auto">
            <button onClick={onClose} disabled={submitting}
              className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-100 transition disabled:opacity-50">
              取消
            </button>
            <button onClick={handleSubmit} disabled={!isValid || submitting}
              className="group relative px-6 py-2.5 rounded-xl font-bold text-sm text-white shadow-lg shadow-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:shadow-violet-500/30">
              <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="relative flex items-center gap-2">
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />添加中...</> : <><Check className="w-4 h-4" />确认添加</>}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label, placeholder, value, onChange, error, required, mono, type = 'text',
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  error?: string; required?: boolean; mono?: boolean; type?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      <input type={type}
        className={`w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-violet-400 focus:ring-4 focus:ring-violet-50 outline-none transition-all text-sm font-semibold text-slate-700 ${
          mono ? 'font-mono' : ''
        } ${error ? 'ring-2 ring-rose-200' : ''}`}
        placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
      {error && <p className="text-xs text-rose-500 font-bold">{error}</p>}
    </div>
  );
}