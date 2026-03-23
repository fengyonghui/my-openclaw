import { FolderOpen, FileText, FileCode, MoreVertical, Search, Upload, RefreshCw, Cpu, Database } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function FilesPage({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/files`);
      const data = await res.json();
      setFiles(data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchFiles();
  }, [projectId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Project Workspace</h1>
          <p className="text-sm text-slate-500 font-medium">管理项目工作区内的物理文件、文档与产出代码</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" icon={RefreshCw} onClick={fetchFiles} disabled={loading}>{loading ? '刷新中...' : '刷新列表'}</Button>
          <Button icon={Upload}>上传文件</Button>
        </div>
      </div>

      <Card hover={false} className="p-0 overflow-hidden border-slate-100 shadow-sm">
        <table className="w-full text-left">
          <thead className="border-b border-slate-100 bg-slate-50/50">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">文件名</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">类型</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">大小</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">最近更新</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {files.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-20 text-center">
                  <div className="flex flex-col items-center opacity-30 italic">
                    <FolderOpen className="h-10 w-10 mb-3" />
                    <p className="text-sm font-bold uppercase tracking-widest">{loading ? '正在读取物理目录...' : '工作空间内暂无文件'}</p>
                  </div>
                </td>
              </tr>
            ) : (
              files.map((file) => (
                <tr key={file.name} className="group hover:bg-slate-50/50 transition-all">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-xl bg-slate-100 group-hover:bg-white transition-colors">
                        {file.type === 'code' ? <FileCode className="h-4 w-4 text-blue-500" /> : 
                         file.type === 'doc' ? <FileText className="h-4 w-4 text-amber-500" /> : 
                         file.type === 'config' ? <Database className="h-4 w-4 text-primary-600" /> :
                         <FileText className="h-4 w-4 text-slate-400" />}
                      </div>
                      <span className="text-sm font-bold text-slate-700">{file.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge status="default" className="scale-75 origin-left font-mono">{file.type}</Badge>
                  </td>
                  <td className="px-6 py-4 text-xs font-mono font-bold text-slate-500">{file.size}</td>
                  <td className="px-6 py-4 text-[11px] font-bold text-slate-400">{new Date(file.updatedAt).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"><MoreVertical className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
