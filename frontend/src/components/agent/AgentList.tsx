import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentStore } from '../../store/agentStore';
import { fetchAgents } from '../../services/agent';
import { Plus, Search, Settings, Sparkles } from 'lucide-react';
import { getDisplayAssetUrl } from '../../lib/utils';

const inputClass = 'h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none placeholder:text-[#667085] focus:border-cyan-400/50';

export function AgentList() {
  const navigate = useNavigate();
  const { agents, setAgents, selectAgent, selectedAgentId, closeSidebar } = useAgentStore();
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchAgents()
      .then(setAgents)
      .catch((error) => {
        console.error('Failed to load agents:', error);
      });
  }, [setAgents]);

  const activeAgents = agents.filter((agent) => {
    if (!agent.isActive) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return `${agent.name} ${agent.description}`.toLowerCase().includes(needle);
  });

  const openCreatePage = () => {
    closeSidebar();
    navigate('/agents/create');
  };

  return (
    <div className="space-y-3 p-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#687183]" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} w-full pl-8`} placeholder="搜索智能体" />
      </div>
      <button
        onClick={openCreatePage}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-300/25 bg-cyan-300/8 text-sm text-cyan-100 transition hover:bg-cyan-300/12"
      >
        <Plus className="h-4 w-4" />
        新建智能体
      </button>
      <button
        onClick={() => {
          navigate('/agents');
        }}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] text-sm text-[#dbe3ee] transition hover:bg-white/[0.08] hover:text-white"
      >
        <Settings className="h-4 w-4" />
        智能体管理
      </button>

      {activeAgents.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <Sparkles className="mx-auto mb-2 h-10 w-10 opacity-50" />
          <p className="text-xs">暂无可用的智能体</p>
        </div>
      ) : (
        activeAgents.map((agent) => {
          const isSelected = selectedAgentId === agent.id;
          return (
            <button
              key={agent.id}
              onClick={() => selectAgent(agent.id)}
              className={`w-full rounded-xl p-2.5 text-left transition-all ${
                isSelected
                  ? 'border border-cyan-400/30 bg-cyan-400/10'
                  : 'border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
                  {agent.thumbnail ? <img src={getDisplayAssetUrl(agent.thumbnail)} alt={agent.name} className="h-full w-full object-cover" /> : <Sparkles className="h-4 w-4 text-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-white">{agent.name}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-4 text-gray-400">{agent.description}</p>
                </div>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
