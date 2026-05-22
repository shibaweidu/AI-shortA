// Agent 系统类型定义

export type AgentType = 'preset' | 'custom';

export type AgentCategory = 'prompt-optimization' | 'storyboard' | 'general' | 'custom';

export interface Agent {
  id: string;
  name: string;
  description: string;
  category: AgentCategory;
  type: AgentType;
  thumbnail?: string; // 缩略图URL
  systemPrompt: string; // Agent的系统提示词/身份功能
  modelId?: string; // 使用的模型ID
  temperature?: number; // 温度参数
  maxTokens?: number; // 最大token数
  createdAt: number;
  updatedAt: number;
  isActive: boolean; // 是否启用
}

export interface AgentMessage {
  id: string;
  agentId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: AgentAttachment[]; // 附件（图片、文件等）
}

export interface AgentAttachment {
  id: string;
  type: 'image' | 'file';
  url: string;
  name: string;
  size?: number;
}

export interface AgentConversation {
  id: string;
  agentId: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentChatRequest {
  agentId: string;
  conversationId: string;
  message: string;
  attachments?: AgentAttachment[];
  modelId?: string;
}

export interface AgentChatResponse {
  messageId: string;
  content: string;
  timestamp: number;
}

// Agent应用到生成器的结果
export interface AgentApplyResult {
  prompt: string;
  referenceImages?: string[];
  suggestedModel?: string;
  suggestedRatio?: string;
  suggestedSize?: string;
}
