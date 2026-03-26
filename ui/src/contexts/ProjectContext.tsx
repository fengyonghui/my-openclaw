import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface Project {
  id: string;
  name: string;
  description?: string;
  workspace: string;
  defaultModel?: string;
  defaultAgentId?: string;
  enabledAgentIds?: string[];
  enabledSkillIds?: string[];
  projectAgents?: any[];
  projectSkills?: any[];
}

interface ProjectContextType {
  project: Project | null;
  agents: any[]; // 项目可用的所有 Agent（全局启用 + 私有）
  skills: any[]; // 项目可用的所有技能（全局启用 + 私有）
  loading: boolean;
  refreshProject: () => void;
}

const ProjectContext = createContext<ProjectContextType>({
  project: null,
  agents: [],
  skills: [],
  loading: true,
  refreshProject: () => {}
});

export function useProject() {
  return useContext(ProjectContext);
}

interface ProjectProviderProps {
  projectId: string;
  children: ReactNode;
}

export function ProjectProvider({ projectId, children }: ProjectProviderProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjectData = async () => {
    if (!projectId) return;
    
    setLoading(true);
    try {
      // 并行加载项目信息、Agent 和技能
      const [projectRes, agentsRes, skillsRes] = await Promise.all([
        fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/skills`)
      ]);

      const [projectData, agentsData, skillsData] = await Promise.all([
        projectRes.json(),
        agentsRes.json(),
        skillsRes.json()
      ]);

      setProject(projectData);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      setSkills(Array.isArray(skillsData) ? skillsData : []);
      
      console.log('[ProjectContext] 项目数据加载完成:', {
        project: projectData.name,
        agentsCount: agents.length,
        skillsCount: skills.length
      });
    } catch (err) {
      console.error('[ProjectContext] 加载失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjectData();
  }, [projectId]);

  const refreshProject = () => {
    fetchProjectData();
  };

  return (
    <ProjectContext.Provider value={{ project, agents, skills, loading, refreshProject }}>
      {children}
    </ProjectContext.Provider>
  );
}
