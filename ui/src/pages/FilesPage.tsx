import { FolderOpen, FileText, FileCode, MoreVertical, Search, Upload, RefreshCw, Cpu, Database, Folder, Eye, EyeOff, Settings as SettingsIcon, ChevronRight, ArrowUp, Home, HardDrive } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function FilesPage({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [currentPath, setCurrentPath] = useState('');

  const fetchFiles = async (path: string = '') => {
    try {
      setLoading(true);
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/files?subPath=${encodeURIComponent(path)}&showHidden=${showHidden}`);
      const data = await res.json();
      
      // 排序：文件夹优先，然后按名称排序
      const sorted = Array.isArray(data) ? data.sort((a, b) => {
        if (a.kind === 'directory' && b.kind !== 'directory') return -1;
        if (a.kind !== 'directory' && b.kind === 'directory') return 1;
        return a.name.localeCompare(b.name);
      }) : [];
      
      setFiles(sorted);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchFiles(currentPath);
  }, [projectId, showHidden]);

  // 进入文件夹
  const enterFolder = (folderPath: string) => {
    setCurrentPath(folderPath);
    fetchFiles(folderPath);
  };

  // 返回上一级
  const goUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.join('/');
    setCurrentPath(parentPath);
    fetchFiles(parentPath);
  };

  // 跳转到指定路径（面包屑点击）
  const goToPath = (path: string) => {
    setCurrentPath(path);
    fetchFiles(path);
  };

  // 解析面包屑路径
  const getBreadcrumbs = () => {
    if (!currentPath) return [];
    const parts = currentPath.split('/').filter(Boolean);
    return parts.map((part, index) => ({
      name: part,
      path: parts.slice(0, index + 1).join('/')
    }));
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="space-y-4">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-slate-900 rounded-2xl shadow-xl"><HardDrive className="h-6 w-6 text-white" /></div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Workspace Explorer</h1>
            <p className="text-sm text-slate-500 font-medium">浏览项目工作区文件结构</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button 
            variant="outline" 
            icon={showHidden ? Eye : EyeOff} 
            onClick={() => setShowHidden(!showHidden)}
            className={showHidden ? "bg-amber-50 text-amber-700 border-amber-200" : ""}
          >
            {showHidden ? '隐藏过滤项' : '显示已过滤'}
          </Button>
          <Button variant="outline" icon={RefreshCw} onClick={() => fetchFiles(currentPath)} disabled={loading}>{loading ? '刷新中...' : '刷新'}</Button>
        </div>
      </div>

      {/* 工具栏：面包屑导航 */}
      <Card hover={false} className="p-4 border-slate-200 bg-slate-50 shadow-sm rounded-2xl">
        <div className="flex items-center gap-2">
          {/* 返回上一级按钮 */}
          {currentPath && (
            <button 
              onClick={goUp}
              className="p-2 rounded-xl hover:bg-white hover:shadow-sm transition-all text-slate-500 hover:text-slate-700"
              title="返回上一级"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
          
          {/* 根目录 */}
          <button 
            onClick={() => goToPath('')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold transition-all ${
              !currentPath 
                ? 'bg-primary-100 text-primary-700' 
                : 'hover:bg-white hover:shadow-sm text-slate-600 hover:text-slate-900'
            }`}
          >
            <Home className="h-4 w-4" />
            <span>根目录</span>
          </button>

          {/* 面包屑路径 */}
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.path} className="flex items-center gap-2">
              <ChevronRight className="h-4 w-4 text-slate-300" />
              <button 
                onClick={() => goToPath(crumb.path)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold transition-all ${
                  index === breadcrumbs.length - 1 
                    ? 'bg-primary-100 text-primary-700' 
                    : 'hover:bg-white hover:shadow-sm text-slate-600 hover:text-slate-900'
                }`}
              >
                <Folder className="h-4 w-4" />
                <span>{crumb.name}</span>
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* 文件列表 */}
      <Card hover={false} className="p-0 overflow-hidden border-slate-100 shadow-sm rounded-3xl">
        <table className="w-full text-left">
          <thead className="border-b border-slate-100 bg-slate-50/50">
            <tr>
              <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">名称</th>
              <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">类型</th>
              <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">大小</th>
              <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">修改日期</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center text-slate-400">
                    <RefreshCw className="h-8 w-8 mb-3 animate-spin" />
                    <p className="text-sm font-bold">正在加载...</p>
                  </div>
                </td>
              </tr>
            ) : files.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center opacity-30 italic">
                    <FolderOpen className="h-10 w-10 mb-3" />
                    <p className="text-sm font-bold uppercase tracking-widest">当前目录为空</p>
                  </div>
                </td>
              </tr>
            ) : (
              files.map((file) => (
                <tr 
                  key={file.path} 
                  className={`group hover:bg-slate-50/50 transition-all cursor-pointer ${
                    file.isHidden ? 'opacity-40 grayscale-[0.5]' : ''
                  }`}
                  onClick={() => {
                    if (file.kind === 'directory') {
                      enterFolder(file.path);
                    }
                  }}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl transition-colors ${
                        file.kind === 'directory' 
                          ? 'bg-amber-50 group-hover:bg-amber-100' 
                          : 'bg-slate-100 group-hover:bg-white'
                      }`}>
                        {file.kind === 'directory' ? (
                          <Folder className="h-5 w-5 text-amber-500" />
                        ) : file.type === 'code' ? (
                          <FileCode className="h-5 w-5 text-blue-500" />
                        ) : file.type === 'doc' ? (
                          <FileText className="h-5 w-5 text-emerald-500" />
                        ) : (
                          <FileText className="h-5 w-5 text-slate-400" />
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-700 group-hover:text-primary-600 transition-colors">
                          {file.name}
                        </span>
                        {file.isHidden && (
                          <span className="text-[9px] font-black text-amber-600 uppercase tracking-tighter">
                            已过滤
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <Badge 
                      status={file.kind === 'directory' ? 'warning' : 'default'} 
                      className="scale-75 origin-left font-mono"
                    >
                      {file.kind === 'directory' ? '文件夹' : file.type || '文件'}
                    </Badge>
                  </td>
                  <td className="px-6 py-3 text-xs font-mono font-bold text-slate-500">
                    {file.kind === 'directory' ? '--' : file.size}
                  </td>
                  <td className="px-6 py-3 text-xs font-bold text-slate-400">
                    {new Date(file.updatedAt).toLocaleDateString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button 
                      className="text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        // TODO: 更多操作菜单
                      }}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {/* 状态栏 */}
      <div className="flex items-center justify-between px-2 text-xs text-slate-400 font-medium">
        <span>共 {files.length} 项</span>
        <span>当前路径: {currentPath || '/'}</span>
      </div>
    </div>
  );
}