import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Agent, AgentConversation, AgentMessage } from '../types/agent';

const MAX_PERSISTED_CONVERSATIONS = 24;
const MAX_PERSISTED_MESSAGES_PER_CONVERSATION = 40;
const MAX_PERSISTED_MESSAGE_CHARS = 20_000;
const MAX_PERSISTED_MEMORY_CHARS = 12_000;

type PersistedAgentState = Pick<
  AgentStore,
  'conversations' | 'selectedAgentId' | 'currentConversationId' | 'isSidebarOpen' | 'memories'
>;

function compactMessageForStorage(message: AgentMessage): AgentMessage {
  return {
    ...message,
    content:
      message.content.length > MAX_PERSISTED_MESSAGE_CHARS
        ? `${message.content.slice(0, MAX_PERSISTED_MESSAGE_CHARS)}\n\n[内容过长，已在本地存储中截断]`
        : message.content,
    attachments: undefined,
  };
}

function compactConversationsForStorage(conversations: AgentConversation[]) {
  return conversations
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PERSISTED_CONVERSATIONS)
    .map((conversation) => ({
      ...conversation,
      messages: conversation.messages.slice(-MAX_PERSISTED_MESSAGES_PER_CONVERSATION).map(compactMessageForStorage),
    }));
}

function compactMemoriesForStorage(memories: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(memories).map(([agentId, memory]) => [
      agentId,
      memory.length > MAX_PERSISTED_MEMORY_CHARS ? memory.slice(0, MAX_PERSISTED_MEMORY_CHARS) : memory,
    ])
  );
}

interface AgentStore {
  // Agent列表
  agents: Agent[];
  
  // 对话历史
  conversations: AgentConversation[];
  
  // 当前选中的Agent
  selectedAgentId: string | null;
  
  // 当前对话ID
  currentConversationId: string | null;
  
  // 侧边栏是否打开
  isSidebarOpen: boolean;
  memories: Record<string, string>;
  
  // Actions
  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  deleteAgent: (id: string) => void;
  
  selectAgent: (agentId: string | null) => void;
  selectConversation: (conversationId: string) => void;
  
  createConversation: (agentId: string) => string;
  createAndSelectConversation: (agentId: string) => void;
  getConversation: (conversationId: string) => AgentConversation | undefined;
  getCurrentConversation: () => AgentConversation | undefined;
  addMessage: (conversationId: string, message: Omit<AgentMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Pick<AgentMessage, 'content' | 'attachments'>>) => void;
  clearConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  updateMemory: (agentId: string, memory: string) => void;
  
  toggleSidebar: () => void;
  openSidebar: (agentId?: string) => void;
  closeSidebar: () => void;
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set, get) => ({
      agents: [],
      conversations: [],
      selectedAgentId: null,
      currentConversationId: null,
      isSidebarOpen: false,
      memories: {},

      setAgents: (agents) => set({ agents }),

      addAgent: (agent) =>
        set((state) => ({
          agents: [...state.agents, agent],
        })),

      updateAgent: (id, updates) =>
        set((state) => ({
          agents: state.agents.map((agent) =>
            agent.id === id ? { ...agent, ...updates, updatedAt: Date.now() } : agent
          ),
        })),

      deleteAgent: (id) =>
        set((state) => ({
          agents: state.agents.filter((agent) => agent.id !== id),
          selectedAgentId: state.selectedAgentId === id ? null : state.selectedAgentId,
        })),

      selectAgent: (agentId) => {
        set({ selectedAgentId: agentId });
        
        if (agentId) {
          const state = get();
          // 查找该Agent的最新对话，如果没有则创建新对话
          const existingConversation = state.conversations
            .filter((conv) => conv.agentId === agentId)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0];
          
          if (existingConversation) {
            set({ currentConversationId: existingConversation.id });
          } else {
            const newConversationId = get().createConversation(agentId);
            set({ currentConversationId: newConversationId });
          }
        } else {
          set({ currentConversationId: null });
        }
      },

      selectConversation: (conversationId) => {
        const conversation = get().conversations.find((item) => item.id === conversationId);
        if (!conversation) return;
        set({ selectedAgentId: conversation.agentId, currentConversationId: conversationId });
      },

      createConversation: (agentId) => {
        const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newConversation: AgentConversation = {
          id: conversationId,
          agentId,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        
        set((state) => ({
          conversations: [...state.conversations, newConversation],
        }));
        
        return conversationId;
      },

      createAndSelectConversation: (agentId) => {
        const conversationId = get().createConversation(agentId);
        set({ selectedAgentId: agentId, currentConversationId: conversationId, isSidebarOpen: true });
      },

      getConversation: (conversationId) => {
        return get().conversations.find((conv) => conv.id === conversationId);
      },

      getCurrentConversation: () => {
        const { currentConversationId, conversations } = get();
        if (!currentConversationId) return undefined;
        return conversations.find((conv) => conv.id === currentConversationId);
      },

      addMessage: (conversationId, message) => {
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newMessage: AgentMessage = {
          ...message,
          id: messageId,
          timestamp: Date.now(),
        };

        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: [...conv.messages, newMessage],
                  updatedAt: Date.now(),
                }
              : conv
          ),
        }));
        return messageId;
      },

      updateMessage: (conversationId, messageId, updates) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((message) => (message.id === messageId ? { ...message, ...updates } : message)),
                  updatedAt: Date.now(),
                }
              : conv
          ),
        }));
      },

      clearConversation: (conversationId) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: [],
                  updatedAt: Date.now(),
                }
              : conv
          ),
        }));
      },

      deleteConversation: (conversationId) => {
        set((state) => {
          const nextConversations = state.conversations.filter((conv) => conv.id !== conversationId);
          const deleted = state.conversations.find((conv) => conv.id === conversationId);
          const fallback = deleted
            ? nextConversations.filter((conv) => conv.agentId === deleted.agentId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
            : undefined;

          return {
            conversations: nextConversations,
            currentConversationId: state.currentConversationId === conversationId ? fallback?.id ?? null : state.currentConversationId,
          };
        });
      },

      updateMemory: (agentId, memory) =>
        set((state) => ({
          memories: { ...state.memories, [agentId]: memory },
        })),

      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

      openSidebar: (agentId) => {
        set({ isSidebarOpen: true });
        if (agentId) {
          get().selectAgent(agentId);
        }
      },

      closeSidebar: () => set({ isSidebarOpen: false }),
    }),
    {
      name: 'agent-storage',
      version: 1,
      partialize: (state): PersistedAgentState => ({
        conversations: compactConversationsForStorage(state.conversations),
        selectedAgentId: state.selectedAgentId,
        currentConversationId: state.currentConversationId,
        isSidebarOpen: state.isSidebarOpen,
        memories: compactMemoriesForStorage(state.memories),
      }),
    }
  )
);
