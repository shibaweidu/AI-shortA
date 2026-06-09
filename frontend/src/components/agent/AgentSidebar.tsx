import { ChevronRight, Plus, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAgentStore } from '../../store/agentStore';
import { AgentList } from './AgentList';
import { AgentChat } from './AgentChat';

export function AgentSidebar({ mode = 'overlay' }: { mode?: 'overlay' | 'inline' }) {
  const navigate = useNavigate();
  const { isSidebarOpen, closeSidebar, selectedAgentId } = useAgentStore();

  const content = (
    <div className="flex h-full w-screen border-l border-white/[0.06] bg-[#08090d] shadow-xl md:w-[min(798px,calc(100vw-44px))]">
      <div className="hidden w-[240px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0d0f14] sm:flex">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-3">
          <h2 className="text-sm font-semibold text-white">智能体</h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                navigate('/agents');
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[#cfd7e6] transition hover:bg-white/[0.08] hover:text-white"
              title="智能体管理"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                closeSidebar();
                navigate('/agents/create');
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[#cfd7e6] transition hover:bg-white/[0.08] hover:text-white"
              title="新建智能体"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AgentList />
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selectedAgentId ? (
          <AgentChat />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[#687183]">
            <div className="text-center text-sm">请选择一个智能体，或新建自定义智能体。</div>
          </div>
        )}
      </div>
    </div>
  );

  if (mode === 'inline') {
    if (!isSidebarOpen) {
      return null;
    }

    return (
      <div className="fixed bottom-[76px] right-0 top-0 z-50 h-auto shrink-0 md:relative md:inset-auto md:z-auto md:h-full">
        <button
          onClick={closeSidebar}
          className="absolute left-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-[#11141b] text-[#8f97aa] shadow-[0_18px_48px_rgba(0,0,0,0.35)] transition hover:bg-[#181b22] hover:text-white md:-left-8 md:top-1/2 md:h-16 md:w-8 md:-translate-y-1/2 md:rounded-l-lg md:rounded-r-none md:border-r-0"
          aria-label="收起智能体侧栏"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {content}
      </div>
    );
  }

  if (!isSidebarOpen) {
    return null;
  }

  return (
    <div className="fixed bottom-[76px] right-0 top-0 z-50 flex h-auto md:bottom-0">
      <button
        onClick={closeSidebar}
        className="absolute -left-8 top-1/2 flex h-16 w-8 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-white/[0.08] bg-[#11141b] text-[#8f97aa] shadow-[0_18px_48px_rgba(0,0,0,0.35)] transition hover:bg-[#181b22] hover:text-white"
        aria-label="收起智能体侧栏"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {content}
    </div>
  );
}
