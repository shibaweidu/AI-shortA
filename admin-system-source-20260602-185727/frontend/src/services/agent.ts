import type { Agent, AgentAttachment, AgentChatResponse } from '../types/agent';

const API_BASE = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, '') || 'http://127.0.0.1:8787';

export type UploadedImageFile = {
  url: string;
  name: string;
  size: number;
  mimeType: string;
};

export async function uploadImageFiles(files: File[]): Promise<UploadedImageFile[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append('images', file));

  const response = await fetch(`${API_BASE}/api/uploads/images`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || 'Failed to upload images');
  }
  const data = await response.json() as { files?: UploadedImageFile[] };
  return data.files ?? [];
}

export async function fetchAgents(): Promise<Agent[]> {
  const response = await fetch(`${API_BASE}/api/agents`);
  if (!response.ok) {
    throw new Error('Failed to fetch agents');
  }
  return response.json();
}

export async function fetchAgent(id: string): Promise<Agent> {
  const response = await fetch(`${API_BASE}/api/agents/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch agent');
  }
  return response.json();
}

export async function createAgent(agent: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
  const response = await fetch(`${API_BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agent),
  });
  if (!response.ok) {
    throw new Error('Failed to create agent');
  }
  return response.json();
}

export async function updateAgent(id: string, updates: Partial<Agent>): Promise<Agent> {
  const response = await fetch(`${API_BASE}/api/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    throw new Error('Failed to update agent');
  }
  return response.json();
}

export async function deleteAgent(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/agents/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete agent');
  }
}

export async function sendAgentMessage(
  agentId: string,
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
  provider: { baseUrl: string; key: string; id?: string; name?: string },
  modelId?: string,
  attachments?: AgentAttachment[]
): Promise<AgentChatResponse> {
  const response = await fetch(`${API_BASE}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversationHistory,
      provider,
      modelId,
      attachments,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message');
  }
  return response.json();
}

type AgentStreamEvent = {
  content?: string;
  messageId?: string;
  timestamp?: number;
  error?: string;
};

function parseAgentStreamEvent(eventText: string) {
  const eventName = eventText
    .split(/\r?\n/)
    .find((line) => line.startsWith('event:'))
    ?.replace(/^event:\s?/, '')
    .trim() || 'message';
  const dataText = eventText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s?/, ''))
    .join('\n')
    .trim();

  if (!dataText) return null;
  return {
    event: eventName,
    data: JSON.parse(dataText) as AgentStreamEvent,
  };
}

export async function streamAgentMessage(
  agentId: string,
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
  provider: { baseUrl: string; key: string; id?: string; name?: string },
  modelId: string | undefined,
  attachments: AgentAttachment[] | undefined,
  onDelta: (delta: string) => void
): Promise<AgentChatResponse> {
  const response = await fetch(`${API_BASE}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversationHistory,
      provider,
      modelId,
      attachments,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || 'Failed to send message');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.body || !/text\/event-stream/i.test(contentType)) {
    const data = await response.json() as AgentChatResponse;
    if (data.content) onDelta(data.content);
    return data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let messageId = '';
  let timestamp = Date.now();

  const handleEvent = (eventText: string) => {
    const parsed = parseAgentStreamEvent(eventText);
    if (!parsed) return;

    if (parsed.event === 'delta') {
      const delta = parsed.data.content ?? '';
      if (!delta) return;
      content += delta;
      onDelta(delta);
      return;
    }

    if (parsed.event === 'error') {
      throw new Error(parsed.data.error || 'Agent stream failed');
    }

    if (parsed.event === 'done') {
      messageId = parsed.data.messageId ?? messageId;
      timestamp = parsed.data.timestamp ?? timestamp;
    }
  };

  const drainBuffer = (flush = false) => {
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = flush ? '' : events.pop() ?? '';
    for (const eventText of events) handleEvent(eventText);
    if (flush && buffer.trim()) handleEvent(buffer);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drainBuffer(false);
  }

  buffer += decoder.decode();
  drainBuffer(true);

  return {
    messageId: messageId || `msg_${Date.now()}`,
    content,
    timestamp,
  };
}
