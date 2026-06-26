import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { AtSign, Check, CheckCircle2, ChevronDown, Copy, Loader2, MessageSquarePlus, Plus, Save, Search, Send, Trash2, Upload, Wand2, X } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useFlowStore } from '../../store/flowStore';
import { streamAgentMessage, uploadImageFiles } from '../../services/agent';
import { useSettingsStore } from '../../store/settingsStore';
import { useUserModelStore } from '../../store/userModelStore';
import { buildGeneratorModelOptions } from '../../lib/generatorOptions';
import { buildModelCatalogOptions, getPreferredModelValue } from '../../lib/modelCatalog';
import { parseSourcedProviderModelValue } from '../../lib/providerModels';
import { withSelectedProviderKey } from '../../lib/providerKeys';
import { getDataUrlFromPersistedAssetFile } from '../../services/localFiles';
import { resolveReferenceImageDataUrl } from '../../services/referenceImages';
import { Textarea } from '../ui/textarea';
import { cn, getDisplayAssetUrl } from '../../lib/utils';
import type { AgentAttachment } from '../../types/agent';

function createAttachmentId() {
  return `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function AgentMessageContent({ content, role }: { content: string; role: 'user' | 'assistant' | 'system' }) {
  if (role !== 'assistant') {
    return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</p>;
  }

  const blocks: ReactNode[] = [];
  const paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const lines = [...paragraph];
    paragraph.length = 0;
    blocks.push(
      <p key={`p-${blocks.length}`} className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-100">
        {lines.map((line, index) => (
          <span key={index}>
            {index > 0 ? <br /> : null}
            {renderInlineMarkdown(line)}
          </span>
        ))}
      </p>
    );
  };

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      flushParagraph();
      blocks.push(<hr key={`hr-${blocks.length}`} className="border-white/[0.10]" />);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push(
        <div key={`h-${blocks.length}`} className="text-sm font-semibold leading-6 text-white">
          {renderInlineMarkdown(heading[2])}
        </div>
      );
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push(
        <div key={`li-${blocks.length}`} className="flex gap-2 text-sm leading-6 text-gray-100">
          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-cyan-300/80" />
          <div className="min-w-0 break-words">{renderInlineMarkdown(bullet[1])}</div>
        </div>
      );
      continue;
    }

    const quote = trimmed.match(/^>\s*(.+)$/);
    if (quote) {
      flushParagraph();
      blocks.push(
        <blockquote key={`q-${blocks.length}`} className="border-l-2 border-cyan-300/50 pl-3 text-sm leading-6 text-cyan-50/90">
          {renderInlineMarkdown(quote[1])}
        </blockquote>
      );
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return <div className="space-y-2">{blocks}</div>;
}

export function AgentChat() {
  const { selectedAgentId, agents, getCurrentConversation, addMessage, updateMessage } = useAgentStore();
  const {
    conversations,
    currentConversationId,
    createAndSelectConversation,
    selectConversation,
    deleteConversation,
    memories,
    updateMemory,
  } = useAgentStore();
  const { providers, routing } = useSettingsStore();
  const { providers: userProviders, routing: userRouting } = useUserModelStore();
  const { projects, items } = useFlowStore();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [openPanel, setOpenPanel] = useState<'model' | 'assets' | null>(null);
  const [assetProjectId, setAssetProjectId] = useState<string | 'all'>('all');
  const [assetSort, setAssetSort] = useState<'newest' | 'oldest'>('newest');
  const [assetSearch, setAssetSearch] = useState('');
  const [assetPreviewUrl, setAssetPreviewUrl] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<{ x: number; y: number } | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyToastTimerRef = useRef<number | null>(null);

  const agent = agents.find((item) => item.id === selectedAgentId);
  const conversation = getCurrentConversation();
  const agentConversations = conversations
    .filter((item) => item.agentId === selectedAgentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const memory = selectedAgentId ? memories[selectedAgentId] ?? '' : '';
  const [memoryDraft, setMemoryDraft] = useState(memory);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const modelOptions = useMemo(
    () => [
      ...buildGeneratorModelOptions(buildModelCatalogOptions(providers, routing, 'language', 'koala')),
      ...buildGeneratorModelOptions(buildModelCatalogOptions(userProviders, userRouting, 'language', 'custom')),
    ],
    [providers, routing, userProviders, userRouting]
  );
  const selectedModelOption = modelOptions.find((model) => model.value === selectedModel) ?? modelOptions[0];
  const imageAssets = useMemo(() => {
    let list = items.filter((item) => item.type === 'image' && !!item.url);
    if (assetProjectId !== 'all') {
      list = list.filter((item) => item.projectId === assetProjectId);
    }

    const query = assetSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((item) => (item.prompt ?? '').toLowerCase().includes(query));
    }

    return [...list].sort((a, b) => (assetSort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [assetProjectId, assetSearch, assetSort, items]);
  const previewAssetUrl = assetPreviewUrl ?? attachments[0]?.url ?? imageAssets[0]?.url ?? null;

  useEffect(() => {
    if (selectedModel && modelOptions.some((model) => model.value === selectedModel)) return;
    setSelectedModel(getPreferredModelValue(modelOptions));
  }, [modelOptions, selectedModel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages]);

  useEffect(() => {
    setMemoryDraft(memory);
  }, [memory]);

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current !== null) window.clearTimeout(copyToastTimerRef.current);
    };
  }, []);

  if (!agent || !conversation) return null;

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    if (!selectedModelOption) {
      addMessage(conversation.id, {
        agentId: agent.id,
        role: 'assistant',
        content: '请先在后台模型管理中添加并启用文本模型。',
      });
      return;
    }

    const userMessage = input.trim();
    const messageAttachments = attachments;
    setInput('');
    setAttachments([]);

    addMessage(conversation.id, {
      agentId: agent.id,
      role: 'user',
      content: userMessage,
      attachments: messageAttachments,
    });

    setIsLoading(true);
    let assistantMessageId: string | null = null;
    let streamedContent = '';
    let flushFrame: number | null = null;

    const flushStreamedContent = () => {
      flushFrame = null;
      if (!assistantMessageId) return;
      updateMessage(conversation.id, assistantMessageId, { content: streamedContent });
    };

    const queueFlush = () => {
      if (flushFrame !== null) return;
      flushFrame = window.requestAnimationFrame(flushStreamedContent);
    };

    try {
      const modelValue = selectedModel || selectedModelOption.value;
      const parsedModel = parseSourcedProviderModelValue(modelValue);
      const providerList = parsedModel?.source === 'custom' ? userProviders : providers;
      const provider = parsedModel
        ? providerList.find((item) => item.id === parsedModel.providerId)
        : providers.find((item) => item.baseUrl && item.key);

      if (!provider?.baseUrl || !provider.key) {
        throw new Error('没有可用的文本模型供应商配置');
      }
      const requestProvider = withSelectedProviderKey(provider);

      const conversationHistory = conversation.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const memoryPrompt = memory.trim() ? `\n\n[智能体长期记忆]\n${memory.trim()}` : '';
      assistantMessageId = addMessage(conversation.id, {
        agentId: agent.id,
        role: 'assistant',
        content: '',
      });
      setStreamingMessageId(assistantMessageId);

      const response = await streamAgentMessage(
        agent.id,
        `${userMessage}${memoryPrompt}`,
        conversationHistory,
        {
          baseUrl: requestProvider.baseUrl,
          key: requestProvider.key,
          id: requestProvider.id,
          name: requestProvider.name,
        },
        parsedModel?.modelId || selectedModelOption.value,
        messageAttachments,
        (delta) => {
          streamedContent += delta;
          queueFlush();
        }
      );

      if (flushFrame !== null) {
        window.cancelAnimationFrame(flushFrame);
        flushFrame = null;
      }
      updateMessage(conversation.id, assistantMessageId, { content: response.content || streamedContent });
    } catch (error) {
      console.error('Failed to send message:', error);
      if (assistantMessageId) {
        updateMessage(conversation.id, assistantMessageId, {
          content: `抱歉，发生了错误：${error instanceof Error ? error.message : '未知错误'}`,
        });
      } else {
        addMessage(conversation.id, {
          agentId: agent.id,
          role: 'assistant',
          content: `抱歉，发生了错误：${error instanceof Error ? error.message : '未知错误'}`,
        });
      }
    } finally {
      if (flushFrame !== null) window.cancelAnimationFrame(flushFrame);
      setStreamingMessageId(null);
      setIsLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleApplyToGenerator = (content: string) => {
    window.dispatchEvent(new CustomEvent('agent-apply-prompt', { detail: { prompt: content } }));
  };

  const handleCopyMessage = async (content: string, event: MouseEvent<HTMLButtonElement>) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyToast({ x: event.clientX, y: event.clientY });
      if (copyToastTimerRef.current !== null) window.clearTimeout(copyToastTimerRef.current);
      copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1200);
    } catch (error) {
      console.error('Failed to copy assistant message:', error);
    }
  };

  const handleToggleAsset = async (asset: (typeof imageAssets)[number]) => {
    if (!asset.url) return;
    const attachmentId = `asset_${asset.id}`;
    if (attachments.some((attachment) => attachment.id === attachmentId)) {
      setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
      return;
    }

    setAssetPreviewUrl(asset.url);
    const referenceUrl = asset.savedFileName
      ? (await getDataUrlFromPersistedAssetFile(asset.id).catch(() => null)) ?? await resolveReferenceImageDataUrl(asset.url)
      : await resolveReferenceImageDataUrl(asset.url);
    setAssetPreviewUrl(referenceUrl);
    setAttachments((current) => {
      if (current.some((attachment) => attachment.id === attachmentId)) return current;

      return [
        ...current,
        {
          id: attachmentId,
          type: 'image',
          url: referenceUrl,
          name: asset.prompt?.trim() || '素材图片',
        },
      ];
    });
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    try {
      setIsUploadingAttachment(true);
      const uploadedFiles = await uploadImageFiles(files);
      const uploadedAttachments = await Promise.all(
        uploadedFiles.map(async (file) => ({
          id: createAttachmentId(),
          type: 'image' as const,
          url: await resolveReferenceImageDataUrl(file.url),
          name: file.name,
          size: file.size,
        }))
      );
      setAttachments((current) => [...current, ...uploadedAttachments]);
    } catch (error) {
      addMessage(conversation.id, {
        agentId: agent.id,
        role: 'assistant',
        content: `图片上传失败：${error instanceof Error ? error.message : '未知错误'}`,
      });
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const getConversationTitle = (item: typeof agentConversations[number], index: number) => {
    const firstMessage = item.messages.find((message) => message.role === 'user')?.content;
    return firstMessage ? firstMessage.slice(0, 22) : `新对话 ${agentConversations.length - index}`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-white">{agent.name}</h3>
          <p className="truncate text-xs text-gray-400">{agent.description}</p>
        </div>
        <button
          onClick={() => createAndSelectConversation(agent.id)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-xs text-[#cfd7e6] transition hover:bg-white/[0.08] hover:text-white"
          title="新建对话"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          新对话
        </button>
      </div>

      <div className="shrink-0 border-b border-white/[0.06] px-4 py-2">
        <div className="flex items-center gap-2">
          <select
            value={currentConversationId ?? ''}
            onChange={(event) => selectConversation(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 text-xs text-[#cfd7e6] outline-none hover:bg-white/[0.06]"
            title="切换对话记录"
          >
            {agentConversations.map((item, index) => (
              <option key={item.id} value={item.id}>
                {getConversationTitle(item, index)}
              </option>
            ))}
          </select>
          {currentConversationId && agentConversations.length > 1 ? (
            <button
              onClick={() => deleteConversation(currentConversationId)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-[#8f97aa] transition hover:bg-white/[0.08] hover:text-white"
              title="删除当前对话"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.03]">
          <button
            onClick={() => setMemoryOpen((current) => !current)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-[#cfd7e6]"
          >
            <span>记忆 {memory.trim() ? '已启用' : '未设置'}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 text-[#687183] transition', memoryOpen && 'rotate-180')} />
          </button>
          {memoryOpen ? (
            <div className="border-t border-white/[0.06] p-3">
              <textarea
                value={memoryDraft}
                onChange={(event) => setMemoryDraft(event.target.value)}
                className="min-h-[86px] w-full resize-y rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs leading-5 text-white outline-none placeholder:text-[#667085]"
                placeholder="记录这个智能体需要长期记住的偏好、品牌风格、输出要求..."
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => updateMemory(agent.id, memoryDraft)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-cyan-400 px-3 text-xs font-medium text-black hover:bg-cyan-300"
                >
                  <Save className="h-3.5 w-3.5" />
                  保存记忆
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {conversation.messages.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <p className="text-sm">开始与 {agent.name} 对话</p>
            <p className="mt-1 text-xs text-gray-600">输入你的问题或需求</p>
          </div>
        ) : (
          conversation.messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 ${
                  message.role === 'user' ? 'bg-cyan-500 text-white' : 'bg-white/[0.06] text-gray-100'
                }`}
              >
                {message.id === streamingMessageId && !message.content ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>正在生成...</span>
                  </div>
                ) : (
                  <AgentMessageContent content={message.content} role={message.role} />
                )}
                {message.attachments?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {message.attachments.map((attachment) => (
                      <img
                        key={attachment.id}
                        src={getDisplayAssetUrl(attachment.url)}
                        alt={attachment.name}
                        className="h-16 w-16 rounded-lg border border-white/[0.12] object-cover"
                      />
                    ))}
                  </div>
                ) : null}
                {message.role === 'assistant' && message.id !== streamingMessageId && message.content ? (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => handleApplyToGenerator(message.content)}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 text-xs text-cyan-300 transition hover:border-cyan-300/35 hover:bg-cyan-400/15 hover:text-cyan-200"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      应用
                    </button>
                    <button
                      onClick={(event) => void handleCopyMessage(message.content, event)}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 text-xs text-[#cfd7e6] transition hover:bg-white/[0.09] hover:text-white"
                    >
                      <Copy className="h-3 w-3" />
                      复制
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
        {isLoading && !streamingMessageId ? (
          <div className="flex justify-start">
            <div className="rounded-xl bg-white/[0.06] px-3 py-2">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-white/[0.045] bg-[#08090d] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4 sm:pb-4">
        <div className="relative rounded-[22px] border border-white/[0.05] bg-[#181a20] shadow-[0_18px_44px_rgba(0,0,0,0.30)]">
          {attachments.length ? (
            <div className="flex gap-2 px-3 pb-1 pt-3 sm:px-4">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/[0.06]">
                  <img src={getDisplayAssetUrl(attachment.url)} alt={attachment.name} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(attachment.id)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 transition-colors hover:bg-black/80"
                    title="移除附件"
                  >
                    <X className="h-3 w-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="px-3 pb-3 pt-3 sm:px-4">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              className={cn(
                'min-h-[64px] w-full resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-[14px] leading-6 text-white shadow-none outline-none ring-0 ring-offset-0 placeholder:text-[#5f6778] focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              )}
              rows={2}
              disabled={isLoading}
            />
          </div>

          <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto border-t border-white/[0.045] px-3 pb-3 pt-2.5 [scrollbar-width:none] sm:flex-wrap sm:px-4 [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAttachment}
              className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-white/8 bg-[#2a2d35] text-[18px] font-medium text-[#cfd6e2] transition hover:border-white/14 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              title="上传文件"
            >
              {isUploadingAttachment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
            <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleFileUpload} className="hidden" />

            <div className="static shrink-0 md:relative">
              <button
                type="button"
                onClick={() => setOpenPanel(openPanel === 'assets' ? null : 'assets')}
                className={cn(
                  'inline-flex h-[34px] shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-white/8 bg-[#2a2d35] px-3 text-[13px] font-medium text-[#cfd6e2] transition hover:border-white/14 hover:text-white',
                  attachments.length > 0 && 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100'
                )}
                title="引用素材"
              >
                <AtSign className="h-4 w-4" />
                <span className="hidden sm:inline">素材</span>
                {attachments.length > 0 ? <span className="rounded-full bg-black/30 px-1.5 text-[10px]">{attachments.length}</span> : null}
              </button>

              {openPanel === 'assets' ? (
                <div className="fixed inset-x-3 bottom-[calc(176px+env(safe-area-inset-bottom))] z-40 flex max-h-[48dvh] overflow-hidden rounded-2xl border border-white/8 bg-[#1b1e25] shadow-[0_28px_60px_rgba(0,0,0,0.55)] md:absolute md:inset-x-auto md:bottom-[calc(100%+10px)] md:right-0 md:max-h-[70vh] md:w-[min(720px,calc(100vw-300px))]">
                  <div className="flex min-h-0 w-full flex-col md:w-[420px] md:shrink-0">
                    <div className="grid grid-cols-2 gap-2 border-b border-white/[0.06] px-3 py-2 md:flex md:items-center">
                      <select
                        value={assetProjectId}
                        onChange={(event) => setAssetProjectId(event.target.value as typeof assetProjectId)}
                        className="h-8 rounded-md bg-[#262a33] px-2 text-xs text-white outline-none"
                      >
                        <option value="all">全部项目</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>

                      <div className="relative col-span-2 flex-1 md:col-span-1">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#7a8295]" />
                        <input
                          value={assetSearch}
                          onChange={(event) => setAssetSearch(event.target.value)}
                          placeholder="搜索素材"
                          className="h-8 w-full rounded-md bg-[#262a33] pl-7 pr-2 text-xs text-white outline-none placeholder:text-[#6b7384]"
                        />
                      </div>

                      <select
                        value={assetSort}
                        onChange={(event) => setAssetSort(event.target.value as typeof assetSort)}
                        className="h-8 rounded-md bg-[#262a33] px-2 text-xs text-white outline-none"
                      >
                        <option value="newest">最新</option>
                        <option value="oldest">最早</option>
                      </select>
                    </div>

                    <div className="min-h-[240px] flex-1 overflow-y-auto px-2 py-2 md:max-h-[420px] md:min-h-[300px]">
                      {imageAssets.length === 0 ? (
                        <div className="flex h-full items-center justify-center py-8 text-xs text-[#7a8295]">
                          当前筛选下还没有可用素材
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {imageAssets.map((asset) => {
                            const selected = !!asset.url && attachments.some((attachment) => attachment.id === `asset_${asset.id}` || attachment.url === asset.url);
                            return (
                              <button
                                key={asset.id}
                                type="button"
                                onClick={() => void handleToggleAsset(asset)}
                                onMouseEnter={() => setAssetPreviewUrl(asset.url ?? null)}
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition',
                                  selected ? 'bg-cyan-400/10 text-white' : 'text-[#d5d9e2] hover:bg-white/[0.05]'
                                )}
                              >
                                <img
                                  src={getDisplayAssetUrl(asset.url)}
                                  alt={asset.prompt || 'asset'}
                                  className="h-10 w-10 shrink-0 rounded-md object-cover"
                                />
                                <span className="line-clamp-1 flex-1 text-xs">{asset.prompt || '未命名素材'}</span>
                                {selected ? <Check className="h-4 w-4 shrink-0 text-cyan-200" /> : null}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        fileInputRef.current?.click();
                        setOpenPanel(null);
                      }}
                      className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-3 text-left text-sm text-[#d5d9e2] transition hover:bg-white/[0.04] hover:text-white"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#262a33]">
                        <Upload className="h-4 w-4" />
                      </div>
                      <span>上传图片</span>
                    </button>
                  </div>

                  <div className="hidden min-h-[360px] flex-1 flex-col border-l border-white/[0.06] bg-[#14171d] p-4 md:flex">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm text-white">预览</div>
                      <div className="text-xs text-[#7a8295]">已选 {attachments.length} 张</div>
                    </div>
                    <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-black/20 p-3">
                      {previewAssetUrl ? (
                        <img src={getDisplayAssetUrl(previewAssetUrl)} alt="预览" className="max-h-[360px] max-w-full rounded-lg object-contain" />
                      ) : (
                        <div className="text-xs text-[#6b7384]">选择左侧素材后会在这里预览</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setOpenPanel(openPanel === 'model' ? null : 'model')}
                className="inline-flex h-[34px] max-w-[calc(100vw-140px)] shrink-0 items-center gap-2 rounded-[10px] border border-white/8 bg-[#2a2d35] px-3 text-[13px] font-medium text-white transition hover:border-white/14 sm:max-w-[220px]"
              >
                {selectedModelOption?.imageUrl ? (
                  <img src={selectedModelOption.imageUrl} alt={selectedModelOption.label} className="h-5 w-5 rounded-md object-contain" />
                ) : (
                  <Wand2 className="h-4 w-4 text-white/80" />
                )}
                <span className="truncate">{selectedModelOption?.label ?? '选择文本模型'}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-[#687183] transition', openPanel === 'model' && 'rotate-180')} />
              </button>

              {openPanel === 'model' ? (
                <div className="fixed inset-x-3 bottom-[calc(176px+env(safe-area-inset-bottom))] z-30 max-h-[48dvh] overflow-hidden rounded-[14px] bg-[#1C1C1E] p-3 shadow-[0_24px_50px_rgba(0,0,0,0.45)] sm:absolute sm:inset-x-auto sm:bottom-[calc(100%+10px)] sm:right-0 sm:w-[min(420px,calc(100vw-40px))]">
                  <div className="mb-3 text-sm font-medium text-[#ffffff90]">选择文本模型</div>
                  <div className="max-h-[44dvh] space-y-2 overflow-y-auto pr-1 sm:max-h-[300px]">
                    {modelOptions.length ? (
                      modelOptions.map((option) => {
                        const selected = option.value === selectedModel;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setSelectedModel(option.value);
                              setOpenPanel(null);
                            }}
                            className={cn(
                              'group flex w-full gap-3 rounded-[12px] border border-[rgba(255,255,255,0.08)] px-[10px] py-3 text-left transition-all',
                              selected ? 'border-sky-300/35 bg-sky-300/16 shadow-[0_0_0_1px_rgba(125,211,252,0.12)]' : 'text-[#e4e9f1] hover:bg-[rgba(255,255,255,0.05)]'
                            )}
                          >
                            <div className="flex h-[64px] w-[64px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-[#1B1B20]">
                              {option.imageUrl ? (
                                <img src={option.imageUrl} alt={option.label} className="h-10 w-10 rounded-[12px] object-contain" />
                              ) : (
                                <Wand2 className="h-7 w-7 text-white/70" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="truncate text-[14px] font-medium text-white">{option.label}</div>
                                {option.source ? (
                                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', option.source === 'custom' ? 'bg-violet-400/10 text-violet-200' : 'bg-cyan-400/10 text-cyan-200')}>
                                    {option.source === 'custom' ? '自定义' : '考拉AI'}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 truncate text-xs text-[#99A0AE]">{option.providerName}</div>
                              {option.description ? <div className="mt-1 line-clamp-2 text-xs leading-4 text-[#b2bac8]">{option.description}</div> : null}
                              {option.labels?.length ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {option.labels.slice(0, 3).map((label) => (
                                    <span key={label} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            {selected ? <CheckCircle2 className="h-4 w-4 text-white" /> : null}
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/[0.10] px-3 py-4 text-sm text-[#8f97aa]">
                        还没有启用文本模型，请先到后台模型管理添加并启用文本模型。
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-3">
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading || !selectedModelOption}
                className="flex h-[36px] w-[36px] items-center justify-center rounded-full border-0 bg-[#343944] text-[#7d8596] shadow-none transition hover:bg-[#404653] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="发送消息"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
      {copyToast ? (
        <div
          className="pointer-events-none fixed z-[1000] rounded-full border border-white/10 bg-[#20242d] px-3 py-1.5 text-xs font-medium text-white shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
          style={{ left: copyToast.x + 12, top: copyToast.y + 12 }}
        >
          已复制
        </div>
      ) : null}
    </div>
  );
}
