import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Plus, X, Check, Trash2, Edit, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';

interface PageData<T> {
  records: T[];
  total: number;
  pages: number;
  current: number;
  size: number;
}

interface TableMetadata {
  id?: number;
  tableName: string;
  displayName: string;
  description: string;
  businessKeywords: string;
  intentTags: string;
  priority: number;
  isPrimary: boolean;
  exampleQuestions: string;
  createdAt?: string;
  updatedAt?: string;
}

const INTENT_OPTIONS = [
  { value: 'TICKET', label: 'TICKET (取号业务)' },
  { value: 'TICKET_STAT', label: 'TICKET_STAT (工单统计)' },
  { value: 'ATTENDANCE', label: 'ATTENDANCE (考勤打卡)' },
  { value: 'VISIT_STAT', label: 'VISIT_STAT (访问统计)' },
  { value: 'USER', label: 'USER (人员信息)' },
  { value: 'OTHER', label: 'OTHER (其他)' },
];

const metadataApi = {
  listPage: async (pageNum: number, pageSize: number, keyword?: string) => {
    const params = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize) });
    if (keyword) params.set('keyword', keyword);
    const res = await fetch(`http://localhost:3001/api/v1/table-metadata?${params}`);
    return res.json();
  },
  save: async (data: any) => {
    const res = await fetch('http://localhost:3001/api/v1/table-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  update: async (id: number, data: any) => {
    const res = await fetch(`http://localhost:3001/api/v1/table-metadata/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  delete: async (id: number) => {
    const res = await fetch(`http://localhost:3001/api/v1/table-metadata/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  refreshCache: async () => {
    const res = await fetch('http://localhost:3001/api/v1/table-metadata/refresh-cache', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

function Toast({ type, msg, onClose }: { type: 'success' | 'error'; msg: string; onClose: () => void }) {
  return (
    <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 flex items-center animate-in fade-in slide-in-from-top-2 ${
      type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
    }`}>
      {type === 'success' ? <CheckCircle2 className="w-4 h-4 mr-2 flex-shrink-0" /> : <X className="w-4 h-4 mr-2 flex-shrink-0" />}
      <span className="text-sm font-medium">{msg}</span>
      <button onClick={onClose} className="ml-3 opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
    </div>
  );
}

export const MetadataModule: React.FC = () => {
  const [data, setData] = useState<TableMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editData, setEditData] = useState<TableMetadata>({
    tableName: '', displayName: '', description: '',
    businessKeywords: '', intentTags: 'TICKET', priority: 50,
    isPrimary: false, exampleQuestions: '',
  });
  const [keywords, setKeywords] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await metadataApi.listPage(pageNum, pageSize, keyword || undefined);
      setData(result.data?.records || []);
      setTotal(result.data?.total || 0);
    } catch (err: any) {
      console.error('加载失败:', err);
      showToast('error', '加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [pageNum, pageSize, keyword, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPageNum(1);
    fetchData();
  };

  const handleRefresh = async () => {
    try {
      await metadataApi.refreshCache();
      showToast('success', '缓存已刷新');
    } catch { showToast('error', '刷新失败'); }
  };

  const openModal = (record?: TableMetadata) => {
    if (record) {
      setEditData({ ...record });
      setKeywords((record.businessKeywords || '').split(',').filter(Boolean));
    } else {
      setEditData({ tableName: '', displayName: '', description: '', businessKeywords: '', intentTags: 'TICKET', priority: 50, isPrimary: false, exampleQuestions: '' });
      setKeywords([]);
    }
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); };

  const handleAddKeyword = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
      const newKw = e.currentTarget.value.trim();
      if (!keywords.includes(newKw)) setKeywords([...keywords, newKw]);
      e.currentTarget.value = '';
    }
  };

  const handleRemoveKeyword = (index: number) => setKeywords(keywords.filter((_, i) => i !== index));

  const handleSave = async () => {
    if (!editData.tableName.trim() || !editData.displayName.trim()) {
      showToast('error', '请填写表名和业务名称'); return;
    }
    setSaving(true);
    try {
      const payload = { ...editData, isPrimary: editData.isPrimary ? 1 : 0, businessKeywords: keywords.join(',') };
      if (editData.id) { await metadataApi.update(editData.id, payload); showToast('success', '更新成功'); }
      else { await metadataApi.save(payload); showToast('success', '新增成功'); }
      closeModal();
      fetchData();
    } catch (err: any) { showToast('error', err.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该配置吗？')) return;
    try { await metadataApi.delete(id); showToast('success', '删除成功'); fetchData(); }
    catch (err: any) { showToast('error', err.message || '删除失败'); }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="max-w-7xl mx-auto">
      {toast && <Toast type={toast.type} msg={toast.msg} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold text-gray-800">数据库表语义配置</h2>
          <p className="text-sm text-gray-500 mt-1">配置业务关键词和意图标签，帮助 AI 更精准地匹配查询表。</p>
        </div>
        <button onClick={() => openModal()}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-sm transition-colors">
          <Plus className="w-4 h-4 mr-2" /> 新增配置
        </button>
      </div>

      {/* Table Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <form onSubmit={handleSearch} className="relative w-64">
            <input type="text" placeholder="搜索表名或关键词..." value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          </form>
          <div className="flex space-x-2">
            <button onClick={handleSearch}
              className="px-3 py-1.5 border border-gray-300 bg-white rounded text-sm text-gray-600 hover:bg-gray-50 flex items-center">
              <Search className="w-4 h-4 mr-1" /> 筛选
            </button>
            <button onClick={handleRefresh}
              className="px-3 py-1.5 border border-gray-300 bg-white rounded text-sm text-gray-600 hover:bg-gray-50 flex items-center">
              <RefreshCw className="w-4 h-4 mr-1" /> 刷新缓存
            </button>
          </div>
        </div>

        {/* Table */}
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
              <th className="px-6 py-4 font-medium">表名</th>
              <th className="px-6 py-4 font-medium">业务名称</th>
              <th className="px-6 py-4 font-medium">业务关键词</th>
              <th className="px-6 py-4 font-medium">意图标签</th>
              <th className="px-6 py-4 font-medium">优先级</th>
              <th className="px-6 py-4 font-medium text-center">状态</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="text-sm divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">加载中...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">暂无数据，点击右上角"新增配置"开始</td></tr>
            ) : (
              data.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-mono text-blue-600 text-sm">{row.tableName}</td>
                  <td className="px-6 py-4 text-gray-800 font-medium">{row.displayName}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {(row.businessKeywords || '').split(',').filter(Boolean).map((k, i) => (
                        <span key={i} className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-xs border border-blue-100">{k}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-purple-50 text-purple-600 px-2 py-1 rounded text-xs font-medium border border-purple-100">{row.intentTags}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="w-16 h-1.5 bg-gray-200 rounded-full mr-2">
                        <div className="h-1.5 bg-blue-500 rounded-full" style={{ width: `${row.priority}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{row.priority}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {row.isPrimary ? (
                      <span className="text-green-500 flex items-center justify-center"><Check className="w-4 h-4 mr-1" /> 主表</span>
                    ) : (
                      <span className="text-gray-400">辅助表</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => openModal(row)}
                      className="text-blue-600 hover:text-blue-800 font-medium text-sm mr-3 flex items-center inline-flex">
                      <Edit className="w-4 h-4 mr-1" /> 配置
                    </button>
                    <button onClick={() => handleDelete(row.id!)}
                      className="text-red-500 hover:text-red-700 font-medium text-sm inline-flex items-center">
                      <Trash2 className="w-4 h-4 mr-1" /> 删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
          <span className="text-sm text-gray-500">共 {total} 条数据</span>
          <div className="flex space-x-1">
            <button onClick={() => setPageNum((p) => Math.max(1, p - 1))} disabled={pageNum === 1}
              className="px-3 py-1 border border-gray-300 rounded bg-white text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 flex items-center">
              <ChevronLeft className="w-4 h-4" /> 上一页
            </button>
            <button className="px-3 py-1 border border-blue-500 rounded bg-blue-50 text-blue-600">{pageNum} / {totalPages}</button>
            <button onClick={() => setPageNum((p) => Math.min(totalPages, p + 1))} disabled={pageNum >= totalPages}
              className="px-3 py-1 border border-gray-300 rounded bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center">
              下一页 <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl flex overflow-hidden max-h-[90vh]">
            {/* Left Form */}
            <div className="w-3/5 p-6 overflow-y-auto border-r border-gray-200">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-gray-800">配置表元数据</h3>
                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button>
              </div>
              <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">表名 (Table Name)</label>
                    <input type="text" value={editData.tableName}
                      onChange={(e) => setEditData({ ...editData, tableName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm focus:outline-none"
                      readOnly={!!editData.id} placeholder="ow_run_ticket_info" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">业务显示名称</label>
                    <input type="text" value={editData.displayName}
                      onChange={(e) => setEditData({ ...editData, displayName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="用户取号票号信息表" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">业务描述 (给 AI 看的说明)</label>
                  <textarea value={editData.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="记录每一个用户的取号记录..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    业务关键词 <span className="text-xs text-gray-400 font-normal ml-2">输入后按回车添加</span>
                  </label>
                  <div className="flex flex-wrap gap-2 p-2 border border-gray-300 rounded-lg bg-white min-h-[42px]">
                    {keywords.map((kw, i) => (
                      <span key={i} className="inline-flex items-center bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-sm">
                        {kw}
                        <button type="button" onClick={() => handleRemoveKeyword(i)} className="ml-1 text-blue-300 hover:text-blue-600">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <input type="text" onKeyDown={handleAddKeyword}
                      className="border-none outline-none flex-1 min-w-[120px] text-sm"
                      placeholder="输入关键词..." />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">意图标签</label>
                    <select value={editData.intentTags}
                      onChange={(e) => setEditData({ ...editData, intentTags: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {INTENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      搜索优先级: <span className="text-blue-600 font-bold">{editData.priority}</span>
                    </label>
                    <input type="range" min="1" max="100" value={editData.priority}
                      onChange={(e) => setEditData({ ...editData, priority: parseInt(e.target.value) })}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">示例问法</label>
                  <textarea value={editData.exampleQuestions}
                    onChange={(e) => setEditData({ ...editData, exampleQuestions: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="今天有多少人取了号？&#10;各窗口的等待人数是多少？" />
                </div>
                <div className="flex items-center">
                  <input type="checkbox" id="isPrimary" checked={editData.isPrimary}
                    onChange={(e) => setEditData({ ...editData, isPrimary: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                  <label htmlFor="isPrimary" className="ml-2 text-sm text-gray-700">设为查询主表</label>
                </div>
                <div className="flex justify-end space-x-3 pt-2">
                  <button type="button" onClick={closeModal}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">取消</button>
                  <button type="submit" disabled={saving}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {saving ? '保存中...' : (editData.id ? '更新配置' : '创建配置')}
                  </button>
                </div>
              </form>
            </div>

            {/* Right Preview */}
            <div className="w-2/5 p-6 bg-slate-50 overflow-y-auto">
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">AI 识别预览</h4>
              <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                <p className="text-xs text-gray-400 mb-2">发送给 AI 的上下文</p>
                <pre className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">{`表名: ${editData.tableName || '(未填写)'}
业务名称: ${editData.displayName || '(未填写)'}
业务描述: ${editData.description || '(未填写)'}
业务关键词: ${keywords.length > 0 ? keywords.join(', ') : '(未填写)'}
意图标签: ${editData.intentTags}
搜索优先级: ${editData.priority}
${editData.isPrimary ? '✓ 查询主表' : '  辅助表'}
示例问法: ${editData.exampleQuestions || '(未填写)'}`}</pre>
              </div>
              <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-xs text-blue-600">💡 AI 会根据业务关键词和意图标签判断是否使用这张表来回答用户问题。</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};