import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { ArrowLeft, Bot, CheckCircle2, ChevronDown, Copy, Loader2, Plus, Save, Search, Send, Sparkles, Wand2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createAgent, fetchAgents, sendAgentMessage, updateAgent as updateAgentService, uploadImageFiles } from '../../services/agent';
import { buildGeneratorModelOptions } from '../../lib/generatorOptions';
import { buildModelCatalogOptions, getPreferredModelValue } from '../../lib/modelCatalog';
import { parseSourcedProviderModelValue } from '../../lib/providerModels';
import { withSelectedProviderKey } from '../../lib/providerKeys';
import { useSettingsStore } from '../../store/settingsStore';
import { useUserModelStore } from '../../store/userModelStore';
import { useAgentStore } from '../../store/agentStore';
import { cn, getDisplayAssetUrl } from '../../lib/utils';
import type { Agent } from '../../types/agent';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type AgentFormData = Pick<Agent, 'name' | 'description' | 'systemPrompt' | 'category' | 'type' | 'isActive'> & {
  temperature: number;
  maxTokens: number;
  thumbnail: string;
};

const inputClass = 'h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none placeholder:text-[#667085] focus:border-cyan-400/50';
const textareaClass = 'rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-sm text-white outline-none placeholder:text-[#667085] focus:border-cyan-400/50';

const defaultFormData: AgentFormData = {
  name: '',
  description: '',
  systemPrompt: '',
  category: 'custom' as const,
  type: 'custom' as const,
  temperature: 0.7,
  maxTokens: 2000,
  thumbnail: '',
  isActive: true,
};

function buildFormDataFromAgent(agent: Agent): AgentFormData {
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    category: agent.category,
    type: agent.type,
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.maxTokens ?? 2000,
    thumbnail: agent.thumbnail ?? '',
    isActive: agent.isActive,
  };
}

function extractSystemPrompt(text: string): string | null {
  const readJsonSystemPrompt = (value: string) => {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed?.systemPrompt === 'string' && parsed.systemPrompt.trim()) return parsed.systemPrompt.trim();
    } catch {
      return null;
    }
    return null;
  };

  // 尝试提取代码块中的内容
  const codeBlock = text.match(/```(?:json|text|prompt)?\s*([\s\S]*?)```/i)?.[1];
  if (codeBlock?.trim()) return readJsonSystemPrompt(codeBlock.trim()) ?? codeBlock.trim();

  const jsonPrompt = readJsonSystemPrompt(text.trim());
  if (jsonPrompt) return jsonPrompt;

  const quotedSystemPrompt = text.match(/"systemPrompt"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/)?.[1];
  if (quotedSystemPrompt?.trim()) {
    return quotedSystemPrompt.replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
  }
  
  // 如果没有代码块，返回全文
  return text.trim() || null;
}

export default function AgentCreate() {
  const navigate = useNavigate();
  const { addAgent, setAgents: setStoreAgents, updateAgent: updateStoredAgent, selectAgent, openSidebar } = useAgentStore();
  const { providers, routing } = useSettingsStore();
  const { providers: userProviders, routing: userRouting } = useUserModelStore();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentSearch, setAgentSearch] = useState('');
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  
  // 表单数据
  const [formData, setFormData] = useState(defaultFormData);

  // AI 助手对话状态
  const [showAssistant, setShowAssistant] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantMessages, setAssistantMessages] = useState<ChatMessage[]>([]);
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  const [openAssistantPanel, setOpenAssistantPanel] = useState<'model' | null>(null);
  const [copyToast, setCopyToast] = useState<{ x: number; y: number; text: string } | null>(null);
  const copyToastTimerRef = useRef<number | null>(null);

  const textModelOptions = useMemo(
    () => [
      ...buildGeneratorModelOptions(buildModelCatalogOptions(providers, routing, 'language', 'koala')),
      ...buildGeneratorModelOptions(buildModelCatalogOptions(userProviders, userRouting, 'language', 'custom')),
    ],
    [providers, routing, userProviders, userRouting]
  );
  const selectedModelOption = textModelOptions.find((model) => model.value === selectedModel) ?? textModelOptions[0];
  const creatorAgent = agents.find((agent) => agent.name.includes('智能体创建助手')) ?? agents.find((agent) => agent.type === 'preset');
  const editableAgents = agents.filter((agent) => agent.type === 'custom');
  const filteredEditableAgents = editableAgents.filter((agent) => {
    const needle = agentSearch.trim().toLowerCase();
    if (!needle) return true;
    return `${agent.name} ${agent.description}`.toLowerCase().includes(needle);
  });
  const editingAgent = editingAgentId ? agents.find((agent) => agent.id === editingAgentId) ?? null : null;
  const isEditing = !!editingAgent;

  useEffect(() => {
    void loadAgents();
  }, []);

  const loadAgents = async (nextEditingAgentId?: string | null) => {
    try {
      setIsLoadingAgents(true);
      const nextAgents = await fetchAgents();
      setAgents(nextAgents);
      setStoreAgents(nextAgents);

      if (nextEditingAgentId !== undefined) {
        setEditingAgentId(nextEditingAgentId);
        const selected = nextEditingAgentId ? nextAgents.find((agent) => agent.id === nextEditingAgentId) : null;
        setFormData(selected ? buildFormDataFromAgent(selected) : defaultFormData);
      }
    } catch (error) {
      console.error('Failed to load agents:', error);
    } finally {
      setIsLoadingAgents(false);
    }
  };

  useEffect(() => {
    if (selectedModel && textModelOptions.some((model) => model.value === selectedModel)) return;
    setSelectedModel(getPreferredModelValue(textModelOptions));
  }, [selectedModel, textModelOptions]);

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current !== null) window.clearTimeout(copyToastTimerRef.current);
    };
  }, []);

  const showMouseToast = (event: MouseEvent<HTMLButtonElement>, text: string) => {
    setCopyToast({ x: event.clientX, y: event.clientY, text });
    if (copyToastTimerRef.current !== null) window.clearTimeout(copyToastTimerRef.current);
    copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1200);
  };

  const handleApplyAssistantMessage = (content: string, event: MouseEvent<HTMLButtonElement>) => {
    const extractedPrompt = extractSystemPrompt(content) ?? content;
    setFormData((prev) => ({ ...prev, systemPrompt: extractedPrompt }));
    showMouseToast(event, '已应用');
  };

  const handleCopyAssistantMessage = async (content: string, event: MouseEvent<HTMLButtonElement>) => {
    try {
      await navigator.clipboard.writeText(content);
      showMouseToast(event, '已复制');
    } catch (error) {
      console.error('Failed to copy assistant message:', error);
    }
  };

  const handleStartCreate = () => {
    setEditingAgentId(null);
    setFormData(defaultFormData);
    setAssistantMessages([]);
    setAssistantInput('');
  };

  const handleSelectAgentForEdit = (agent: Agent) => {
    setEditingAgentId(agent.id);
    setFormData(buildFormDataFromAgent(agent));
    setAssistantMessages([]);
    setAssistantInput('');
  };

  const handleIconUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      setIsUploadingIcon(true);
      const [uploaded] = await uploadImageFiles([file]);
      if (uploaded?.url) {
        setFormData((current) => ({ ...current, thumbnail: uploaded.url }));
      }
    } catch (error) {
      alert(`图标上传失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsUploadingIcon(false);
    }
  };

  const handleBack = () => {
    openSidebar();
    navigate(-1);
  };

  const handleAssistantSend = async () => {
    if (!assistantInput.trim() || isAssistantLoading) return;
    if (!creatorAgent) {
      alert('后台还没有配置"智能体创建助手"。请先在管理后台创建。');
      return;
    }
    if (!selectedModelOption) {
      alert('请先在模型管理中启用文本模型。');
      return;
    }

    const userMessage = assistantInput.trim();
    setAssistantInput('');
    setAssistantMessages((current) => [...current, { role: 'user', content: userMessage }]);
    setIsAssistantLoading(true);

    try {
      const modelValue = selectedModel || selectedModelOption.value;
      const parsedModel = parseSourcedProviderModelValue(modelValue);
      const providerList = parsedModel?.source === 'custom' ? userProviders : providers;
      const provider = parsedModel
        ? providerList.find((item) => item.id === parsedModel.providerId)
        : providers.find((item) => item.baseUrl && item.key);

      if (!provider?.baseUrl || !provider.key) throw new Error('没有可用的文本模型供应商配置');
      const requestProvider = withSelectedProviderKey(provider);

      // 构建上下文：包含当前表单信息
      const contextMessage = `当前用户正在创建智能体，已填写信息：
- 名称：${formData.name || '(未填写)'}
- 描述：${formData.description || '(未填写)'}

请根据用户的需求，帮助生成或优化系统提示词（systemPrompt）。`;

      const response = await sendAgentMessage(
        creatorAgent.id,
        userMessage,
        [
          { role: 'system', content: contextMessage },
          ...assistantMessages.map((message) => ({ role: message.role, content: message.content })),
        ],
        { id: requestProvider.id, name: requestProvider.name, baseUrl: requestProvider.baseUrl, key: requestProvider.key },
        parsedModel?.modelId || selectedModelOption.value
      );

      setAssistantMessages((current) => [...current, { role: 'assistant', content: response.content }]);
    } catch (error) {
      setAssistantMessages((current) => [...current, { role: 'assistant', content: `助手调用失败：${error instanceof Error ? error.message : String(error)}` }]);
    } finally {
      setIsAssistantLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.description.trim() || !formData.systemPrompt.trim()) {
      alert('请填写名称、描述和系统提示词');
      return;
    }

    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        category: formData.category,
        type: formData.type,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        thumbnail: formData.thumbnail.trim() || undefined,
        isActive: formData.isActive,
      };

      if (editingAgentId) {
        const agent = await updateAgentService(editingAgentId, payload);
        setAgents((current) => current.map((item) => (item.id === agent.id ? agent : item)));
        updateStoredAgent(agent.id, agent);
        setFormData(buildFormDataFromAgent(agent));
        setEditingAgentId(agent.id);
        selectAgent(agent.id);
      } else {
        const agent = await createAgent(payload as Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>);
        setAgents((current) => [...current, agent]);
        addAgent(agent);
        setEditingAgentId(agent.id);
        setFormData(buildFormDataFromAgent(agent));
        selectAgent(agent.id);
      }
    } catch (error) {
      alert(`${isEditing ? '更新' : '创建'}失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="mx-auto flex h-full max-w-[1760px] flex-1 flex-col overflow-hidden text-white">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <button onClick={handleBack} className="mb-3 inline-flex items-center gap-2 text-sm text-[#8f97aa] transition hover:text-white">
              <ArrowLeft className="h-4 w-4" />
              返回
            </button>
            <h1 className="text-2xl font-semibold">智能体管理</h1>
            <p className="mt-2 text-sm text-[#8f97aa]">左侧选择已创建的智能体进行修改，也可以新建智能体；系统提示词可以手写或让 AI 助手帮忙生成。</p>
          </div>
        </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[300px_minmax(500px,1fr)_640px] 2xl:grid-cols-[320px_minmax(560px,1fr)_720px]">
        {/* 左侧：智能体列表 */}
        <aside className="flex min-h-0 flex-col rounded-[28px] border border-white/[0.08] bg-[#11141b]">
          <div className="border-b border-white/[0.06] px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">智能体列表</div>
                <div className="mt-1 text-xs text-[#8f97aa]">共 {editableAgents.length} 个自定义智能体</div>
              </div>
              <button
                type="button"
                onClick={handleStartCreate}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200 transition hover:bg-cyan-300/18"
                title="新建智能体"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#687183]" />
              <input value={agentSearch} onChange={(event) => setAgentSearch(event.target.value)} className={`${inputClass} w-full pl-8`} placeholder="搜索智能体" />
            </div>
            <button
              type="button"
              onClick={handleStartCreate}
              className={cn(
                'mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm transition',
                !editingAgentId ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-100' : 'border-cyan-300/20 bg-cyan-300/8 text-cyan-100 hover:bg-cyan-300/12'
              )}
            >
              <Plus className="h-4 w-4" />
              新建智能体
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {isLoadingAgents ? (
              <div className="py-12 text-center text-sm text-[#8f97aa]">加载中...</div>
            ) : filteredEditableAgents.length ? (
              filteredEditableAgents.map((agent) => {
                const selected = editingAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => handleSelectAgentForEdit(agent)}
                    className={cn(
                      'w-full rounded-2xl border p-3 text-left transition',
                      selected ? 'border-cyan-300/35 bg-cyan-300/12 shadow-[0_0_0_1px_rgba(103,232,249,0.08)]' : 'border-white/[0.06] bg-white/[0.025] hover:border-white/[0.12] hover:bg-white/[0.04]'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cyan-400/10 text-cyan-200">
                        {agent.thumbnail ? <img src={getDisplayAssetUrl(agent.thumbnail)} alt={agent.name} className="h-full w-full object-cover" /> : <Bot className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-semibold text-white">{agent.name}</div>
                          {!agent.isActive ? <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[#aab3c2]">停用</span> : null}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs leading-4 text-[#8f97aa]">{agent.description}</div>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="flex h-full min-h-[220px] items-center justify-center text-center text-[#687183]">
                <div>
                  <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-45" />
                  <div className="text-sm">还没有自定义智能体</div>
                  <div className="mt-1 text-xs">点击“新建智能体”开始创建</div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* 中间：表单 */}
        <section className="flex min-h-0 flex-col rounded-[28px] border border-white/[0.08] bg-[#11141b]">
          <div className="border-b border-white/[0.06] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold">{isEditing ? '编辑智能体配置' : '创建智能体配置'}</div>
                <div className="text-xs text-[#8f97aa]">{isEditing ? `正在修改：${editingAgent?.name}` : '填写名称、描述和系统提示词'}</div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-cyan-400/10 text-cyan-200">
                {formData.thumbnail ? <img src={getDisplayAssetUrl(formData.thumbnail)} alt="智能体图标" className="h-full w-full object-cover" /> : <Bot className="h-6 w-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white">智能体图标</div>
                <div className="mt-1 text-xs text-[#8f97aa]">上传本地图片，保存后会显示在 Agent 列表中。</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-[#dbe3ee] transition hover:bg-white/[0.08] hover:text-white">
                    {isUploadingIcon ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    上传图标
                    <input type="file" accept="image/*" className="hidden" onChange={handleIconUpload} disabled={isUploadingIcon} />
                  </label>
                  {formData.thumbnail ? (
                    <button
                      type="button"
                      onClick={() => setFormData((current) => ({ ...current, thumbnail: '' }))}
                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-[#cfd7e6] transition hover:bg-white/[0.08] hover:text-white"
                    >
                      <X className="h-4 w-4" />
                      移除
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-white">名称 *</span>
              <input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={`${inputClass} w-full`}
                placeholder="例如：小红书文案助手"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-white">描述 *</span>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className={`${textareaClass} min-h-[80px] w-full resize-y`}
                placeholder="简要说明这个智能体的功能和用途"
              />
            </label>

            <label className="block space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">系统提示词 *</span>
                <button
                  onClick={() => setShowAssistant(!showAssistant)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    showAssistant
                      ? 'bg-cyan-400/20 text-cyan-300 hover:bg-cyan-400/30'
                      : 'bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20'
                  }`}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  AI 帮我写
                </button>
              </div>
              <textarea
                value={formData.systemPrompt}
                onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                className={`${textareaClass} min-h-[320px] w-full resize-y font-mono text-xs leading-6`}
                placeholder="定义智能体的角色、职责、工作方式、输出格式等..."
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-white">温度</span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={formData.temperature}
                  onChange={(e) => setFormData({ ...formData, temperature: Number(e.target.value) })}
                  className={`${inputClass} w-full`}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-white">最大 Token</span>
                <input
                  type="number"
                  min={1}
                  value={formData.maxTokens}
                  onChange={(e) => setFormData({ ...formData, maxTokens: Number(e.target.value) })}
                  className={`${inputClass} w-full`}
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-white/[0.06] p-4">
            <button
              onClick={isEditing ? handleStartCreate : handleBack}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-[#cfd7e6] transition hover:bg-white/[0.08] hover:text-white"
            >
              <X className="h-4 w-4" />
              {isEditing ? '取消编辑' : '取消'}
            </button>
            <button
              onClick={handleSave}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-medium text-black transition hover:bg-cyan-300"
            >
              <Save className="h-4 w-4" />
              {isEditing ? '更新智能体' : '保存智能体'}
            </button>
          </div>
        </section>

        {/* 右侧：AI 助手 */}
        <aside className="flex min-h-0 flex-col rounded-[28px] border border-white/[0.08] bg-[#11141b]">
          <div className="border-b border-white/[0.06] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-400/10 text-purple-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold">智能体创建助手</div>
                <div className="text-xs text-[#8f97aa]">AI 帮你生成系统提示词</div>
              </div>
            </div>
          </div>

          {showAssistant ? (
            <>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {assistantMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center text-[#687183]">
                    <div>
                      <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-50" />
                      <div className="text-sm">告诉我你想创建什么样的智能体</div>
                      <div className="mt-2 text-xs">例如：帮我写一个小红书文案生成器的 prompt</div>
                    </div>
                  </div>
                ) : (
                  assistantMessages.map((message, index) => (
                    <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={
                          message.role === 'user'
                            ? 'max-w-[85%] rounded-2xl bg-cyan-500 px-4 py-3 text-sm text-white'
                            : 'max-w-[90%] rounded-2xl bg-white/[0.06] px-4 py-3 text-sm leading-6 text-[#e4e9f1]'
                        }
                      >
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        {message.role === 'assistant' ? (
                          <div className="mt-3 flex justify-end gap-2 border-t border-white/[0.06] pt-3">
                            <button
                              type="button"
                              onClick={(event) => handleApplyAssistantMessage(message.content, event)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-cyan-400/10 px-3 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/20"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              应用
                            </button>
                            <button
                              type="button"
                              onClick={(event) => void handleCopyAssistantMessage(message.content, event)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 text-xs font-medium text-[#dbe3ee] transition hover:bg-white/[0.12] hover:text-white"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              复制
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
                {isAssistantLoading && <Loader2 className="h-5 w-5 animate-spin text-[#8f97aa]" />}
              </div>

              <div className="border-t border-white/[0.045] p-4">
                <div className="relative rounded-[22px] border border-white/[0.05] bg-[#181a20] shadow-[0_18px_44px_rgba(0,0,0,0.30)]">
                  <div className="px-4 pb-3 pt-3">
                    <textarea
                      value={assistantInput}
                      onChange={(e) => setAssistantInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleAssistantSend();
                        }
                      }}
                      className="min-h-[64px] w-full resize-none bg-transparent text-sm leading-6 text-white outline-none placeholder:text-[#667085]"
                      placeholder="描述你的需求..."
                      disabled={isAssistantLoading}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.045] px-4 pb-3 pt-2.5">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenAssistantPanel(openAssistantPanel === 'model' ? null : 'model')}
                        className="inline-flex h-[34px] max-w-[260px] items-center gap-2 rounded-[10px] border border-white/8 bg-[#2a2d35] px-3 text-[13px] font-medium text-white transition hover:border-white/14"
                      >
                        {selectedModelOption?.imageUrl ? (
                          <img src={selectedModelOption.imageUrl} alt={selectedModelOption.label} className="h-5 w-5 rounded-md object-contain" />
                        ) : (
                          <Wand2 className="h-4 w-4 text-white/80" />
                        )}
                        <span className="truncate">{selectedModelOption?.label ?? '选择文本模型'}</span>
                        <ChevronDown className={cn('h-3.5 w-3.5 text-[#687183] transition', openAssistantPanel === 'model' && 'rotate-180')} />
                      </button>

                      {openAssistantPanel === 'model' ? (
                        <div className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-[420px] max-w-[calc(100vw-96px)] rounded-[14px] bg-[#1C1C1E] p-3 shadow-[0_24px_50px_rgba(0,0,0,0.45)]">
                          <div className="mb-3 text-sm font-medium text-[#ffffff90]">选择文本模型</div>
                          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                            {textModelOptions.length ? (
                              textModelOptions.map((option) => {
                                const selected = option.value === selectedModel;
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                      setSelectedModel(option.value);
                                      setOpenAssistantPanel(null);
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
                                        {option.credits !== undefined && option.credits > 0 ? (
                                          <span className="shrink-0 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                                            {option.credits} 积分
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

                    <div className="ml-auto flex items-center gap-3">
                      <button
                        disabled={!assistantInput.trim() || isAssistantLoading || !selectedModelOption}
                        onClick={handleAssistantSend}
                        className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-[#343944] text-[#7d8596] transition hover:bg-[#404653] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="发送消息"
                      >
                        {isAssistantLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
              <div>
                <Sparkles className="mx-auto mb-3 h-12 w-12 text-purple-300/30" />
                <div className="text-sm text-[#8f97aa]">点击左侧"AI 帮我写"按钮</div>
                <div className="mt-1 text-xs text-[#667085]">让助手帮你生成系统提示词</div>
              </div>
            </div>
          )}
        </aside>
        </div>
      </div>
      {copyToast ? (
        <div
          className="pointer-events-none fixed z-[1000] rounded-full border border-white/10 bg-[#20242d] px-3 py-1.5 text-xs font-medium text-white shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
          style={{ left: copyToast.x + 12, top: copyToast.y + 12 }}
        >
          {copyToast.text}
        </div>
      ) : null}
    </div>
  );
}
