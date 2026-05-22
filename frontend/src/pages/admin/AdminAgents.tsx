import { useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Edit2, Loader2, Plus, Save, Search, Sparkles, Trash2, X } from 'lucide-react';
import { fetchAgents, createAgent, updateAgent, deleteAgent, uploadImageFiles } from '../../services/agent';
import { buildGeneratorModelOptions } from '../../lib/generatorOptions';
import { buildModelCatalogOptions } from '../../lib/modelCatalog';
import { getDisplayAssetUrl } from '../../lib/utils';
import { useSettingsStore } from '../../store/settingsStore';
import type { Agent } from '../../types/agent';

const PANEL_CLASS = 'rounded-[28px] border border-white/[0.08] bg-[#11141b] text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)]';
const INPUT_CLASS = 'h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none placeholder:text-[#667085] focus:border-cyan-400/50';
const TEXTAREA_CLASS = 'rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-sm text-white outline-none placeholder:text-[#667085] focus:border-cyan-400/50';

const defaultDraft: Partial<Agent> = {
  name: '',
  description: '',
  category: 'custom',
  type: 'custom',
  systemPrompt: '',
  modelId: '',
  temperature: 0.7,
  maxTokens: 2000,
  thumbnail: '',
  isActive: true,
};

function buildDraftFromAgent(agent: Agent): Partial<Agent> {
  return {
    ...agent,
    thumbnail: agent.thumbnail ?? '',
    modelId: agent.modelId ?? '',
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.maxTokens ?? 2000,
    isActive: agent.isActive,
  };
}

export default function AdminAgents() {
  const { providers, routing } = useSettingsStore();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [formData, setFormData] = useState<Partial<Agent>>(defaultDraft);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);

  const textModelOptions = useMemo(
    () => buildGeneratorModelOptions(buildModelCatalogOptions(providers, routing, 'language', 'koala')),
    [providers, routing]
  );
  const editingAgent = agents.find((agent) => agent.id === editingAgentId) ?? null;
  const selectedAgent = isCreating ? null : editingAgent ?? agents[0] ?? null;
  const activeEditor = isCreating || !!editingAgent;
  const filteredAgents = agents.filter((agent) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${agent.name} ${agent.description}`.toLowerCase().includes(needle);
  });

  useEffect(() => {
    void loadAgents();
  }, []);

  const loadAgents = async () => {
    try {
      setIsLoading(true);
      setAgents(await fetchAgents());
    } catch (error) {
      console.error('Failed to load agents:', error);
      alert('加载智能体失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setIsCreating(true);
    setEditingAgentId(null);
    setFormData({ ...defaultDraft, modelId: textModelOptions[0]?.value ?? '' });
  };

  const handleEdit = (agent: Agent) => {
    setIsCreating(false);
    setEditingAgentId(agent.id);
    setFormData(buildDraftFromAgent(agent));
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingAgentId(null);
    setFormData(defaultDraft);
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

  const handleSave = async () => {
    try {
      if (!formData.name?.trim() || !formData.description?.trim() || !formData.systemPrompt?.trim()) {
        alert('请填写名称、描述和系统提示词');
        return;
      }

      const payload = {
        ...formData,
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        thumbnail: formData.thumbnail?.trim() || undefined,
        modelId: formData.modelId?.trim() || undefined,
        temperature: Number(formData.temperature ?? 0.7),
        maxTokens: Number(formData.maxTokens ?? 2000),
        category: formData.category ?? 'custom',
        type: formData.type ?? 'custom',
        isActive: formData.isActive !== false,
      };

      if (isCreating) {
        await createAgent(payload as Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>);
      } else if (editingAgentId) {
        await updateAgent(editingAgentId, payload);
      }

      await loadAgents();
      handleCancel();
    } catch (error) {
      console.error('Failed to save agent:', error);
      alert('保存失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个智能体吗？')) return;

    try {
      await deleteAgent(id);
      await loadAgents();
      if (editingAgentId === id) handleCancel();
    } catch (error) {
      console.error('Failed to delete agent:', error);
      alert('删除失败');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#8f97aa]">
        加载中...
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#08090d] p-6 text-white">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">智能体管理</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">用左侧列表选择智能体，右侧编辑配置。内置和自定义智能体会同步到前台 Agent 侧栏。</p>
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-medium text-black transition hover:bg-cyan-300"
        >
          <Plus className="h-4 w-4" />
          新建智能体
        </button>
      </div>

      <div className="grid min-h-[calc(100vh-190px)] gap-5 xl:grid-cols-[380px_1fr]">
        <aside className={PANEL_CLASS}>
          <div className="border-b border-white/[0.06] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">智能体列表</div>
                <div className="mt-1 text-xs text-[#8f97aa]">共 {agents.length} 个，启用 {agents.filter((agent) => agent.isActive).length} 个</div>
              </div>
              <button
                onClick={handleCreate}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#cfd7e6] transition hover:bg-white/[0.08] hover:text-white"
                title="新建智能体"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={`${INPUT_CLASS} w-full pl-9`}
                placeholder="搜索智能体"
              />
            </div>
          </div>

          <div className="max-h-[calc(100vh-285px)] space-y-2 overflow-y-auto p-3">
            {filteredAgents.length ? (
              filteredAgents.map((agent) => {
                const selected = agent.id === selectedAgent?.id && !isCreating;
                return (
                  <button
                    key={agent.id}
                    onClick={() => handleEdit(agent)}
                    className={`group w-full rounded-2xl border p-3 text-left transition ${
                      selected
                        ? 'border-cyan-300/35 bg-cyan-300/12 shadow-[0_0_0_1px_rgba(125,211,252,0.12)]'
                        : 'border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600">
                        {agent.thumbnail ? <img src={getDisplayAssetUrl(agent.thumbnail)} alt={agent.name} className="h-full w-full object-cover" /> : <Sparkles className="h-5 w-5 text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-semibold text-white">{agent.name}</div>
                          {agent.isActive ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#8f97aa]">{agent.description}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#cfd7e6]">{agent.type === 'preset' ? '预设' : '自定义'}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-white/[0.10] px-4 py-10 text-center text-sm text-[#8f97aa]">
                没有匹配的智能体
              </div>
            )}
          </div>
        </aside>

        <section className={PANEL_CLASS}>
          {activeEditor ? (
            <div className="flex min-h-full flex-col">
              <div className="border-b border-white/[0.06] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-white">{isCreating ? '创建智能体' : '编辑智能体'}</div>
                      <div className="mt-1 text-xs text-[#8f97aa]">配置身份、系统提示词、默认文本模型和启用状态。</div>
                    </div>
                  </div>
                  <button
                    onClick={handleCancel}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#cfd7e6] transition hover:bg-white/[0.08] hover:text-white"
                    title="关闭编辑"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto p-5">
                <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-white">名称 *</span>
                        <input value={formData.name ?? ''} onChange={(event) => setFormData({ ...formData, name: event.target.value })} className={`${INPUT_CLASS} w-full`} placeholder="例如：提示词优化助手" />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-white">智能体类型</span>
                        <select value={formData.type ?? 'custom'} onChange={(event) => setFormData({ ...formData, type: event.target.value as 'preset' | 'custom' })} className={`${INPUT_CLASS} w-full bg-[#1b1f29]`}>
                          <option value="preset">预设智能体</option>
                          <option value="custom">自定义智能体</option>
                        </select>
                      </label>
                    </div>

                    <label className="space-y-2 block">
                      <span className="text-sm font-medium text-white">描述 *</span>
                      <textarea value={formData.description ?? ''} onChange={(event) => setFormData({ ...formData, description: event.target.value })} className={`${TEXTAREA_CLASS} min-h-[76px] w-full resize-y`} placeholder="说明这个智能体能帮用户做什么" />
                    </label>

                    <label className="space-y-2 block">
                      <span className="text-sm font-medium text-white">系统提示词 *</span>
                      <textarea value={formData.systemPrompt ?? ''} onChange={(event) => setFormData({ ...formData, systemPrompt: event.target.value })} className={`${TEXTAREA_CLASS} min-h-[280px] w-full resize-y font-mono leading-6`} placeholder="定义智能体身份、输入处理方式、输出格式和禁止事项..." />
                    </label>
                  </div>

                  <div className="space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                    <div>
                      <div className="text-sm font-semibold text-white">运行设置</div>
                      <div className="mt-1 text-xs text-[#8f97aa]">Agent 对话时使用这些默认参数。</div>
                    </div>

                    <label className="space-y-2 block">
                      <span className="text-sm font-medium text-white">默认文本模型</span>
                      <select value={formData.modelId ?? ''} onChange={(event) => setFormData({ ...formData, modelId: event.target.value })} className={`${INPUT_CLASS} w-full bg-[#1b1f29]`}>
                        <option value="">由前台选择</option>
                        {textModelOptions.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                      </select>
                      <p className="text-xs text-[#8f97aa]">前台 Agent 输入框仍可临时切换文本模型。</p>
                    </label>

                    <label className="space-y-2 block">
                      <span className="text-sm font-medium text-white">手动模型 ID</span>
                      <input value={formData.modelId ?? ''} onChange={(event) => setFormData({ ...formData, modelId: event.target.value })} className={`${INPUT_CLASS} w-full`} placeholder="例如 gpt-4o-mini" />
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-white">温度</span>
                        <input type="number" min={0} max={2} step={0.1} value={formData.temperature ?? 0.7} onChange={(event) => setFormData({ ...formData, temperature: Number(event.target.value) })} className={`${INPUT_CLASS} w-full`} />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-white">最大 Token</span>
                        <input type="number" min={1} value={formData.maxTokens ?? 2000} onChange={(event) => setFormData({ ...formData, maxTokens: Number(event.target.value) })} className={`${INPUT_CLASS} w-full`} />
                      </label>
                    </div>

                    <label className="space-y-2 block">
                      <span className="text-sm font-medium text-white">缩略图 URL</span>
                      <input value={formData.thumbnail ?? ''} onChange={(event) => setFormData({ ...formData, thumbnail: event.target.value })} className={`${INPUT_CLASS} w-full`} placeholder="https://..." />
                    </label>

                    <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-3">
                      <div className="mb-3 flex items-center gap-3">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600">
                          {formData.thumbnail ? <img src={getDisplayAssetUrl(formData.thumbnail)} alt="智能体图标" className="h-full w-full object-cover" /> : <Sparkles className="h-5 w-5 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-white">本地图标</div>
                          <div className="mt-1 text-xs text-[#8f97aa]">上传后会自动填入缩略图 URL。</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
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

                    <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-black/20 px-3 py-3">
                      <span>
                        <span className="block text-sm font-medium text-white">启用此智能体</span>
                        <span className="mt-1 block text-xs text-[#8f97aa]">关闭后前台 Agent 列表不显示。</span>
                      </span>
                      <input type="checkbox" checked={formData.isActive !== false} onChange={(event) => setFormData({ ...formData, isActive: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-white/[0.06] p-5">
                <button onClick={handleCancel} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-[#cfd7e6] transition hover:bg-white/[0.08] hover:text-white">
                  <X className="h-4 w-4" />
                  取消
                </button>
                <button onClick={handleSave} className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-medium text-black transition hover:bg-cyan-300">
                  <Save className="h-4 w-4" />
                  保存智能体
                </button>
              </div>
            </div>
          ) : selectedAgent ? (
            <div className="flex min-h-full flex-col">
              <div className="border-b border-white/[0.06] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600">
                      {selectedAgent.thumbnail ? <img src={getDisplayAssetUrl(selectedAgent.thumbnail)} alt={selectedAgent.name} className="h-full w-full object-cover" /> : <Sparkles className="h-6 w-6 text-white" />}
                    </div>
                    <div>
                      <div className="text-xl font-semibold text-white">{selectedAgent.name}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#cfd7e6]">{selectedAgent.type === 'preset' ? '预设' : '自定义'}</span>
                        <span className={selectedAgent.isActive ? 'rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200' : 'rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#8f97aa]'}>{selectedAgent.isActive ? '启用' : '禁用'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(selectedAgent)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-[#cfd7e6] transition hover:bg-white/[0.08] hover:text-white">
                      <Edit2 className="h-4 w-4" />
                      编辑
                    </button>
                    <button onClick={() => handleDelete(selectedAgent.id)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-4 text-sm text-red-200 transition hover:bg-red-500/15">
                      <Trash2 className="h-4 w-4" />
                      删除
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-[1fr_280px]">
                <div className="space-y-5">
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                    <div className="mb-2 text-sm font-semibold text-white">描述</div>
                    <p className="text-sm leading-6 text-[#cfd7e6]">{selectedAgent.description}</p>
                  </div>
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                    <div className="mb-3 text-sm font-semibold text-white">系统提示词</div>
                    <pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/20 p-4 text-sm leading-6 text-[#cfd7e6]">{selectedAgent.systemPrompt}</pre>
                  </div>
                </div>
                <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-sm text-[#cfd7e6]">
                  <div className="text-sm font-semibold text-white">运行参数</div>
                  <div className="flex justify-between gap-3 border-t border-white/[0.06] pt-3"><span className="text-[#8f97aa]">默认模型</span><span className="truncate text-right">{selectedAgent.modelId || '前台选择'}</span></div>
                  <div className="flex justify-between gap-3 border-t border-white/[0.06] pt-3"><span className="text-[#8f97aa]">温度</span><span>{selectedAgent.temperature ?? 0.7}</span></div>
                  <div className="flex justify-between gap-3 border-t border-white/[0.06] pt-3"><span className="text-[#8f97aa]">最大 Token</span><span>{selectedAgent.maxTokens ?? 2000}</span></div>
                  <div className="flex justify-between gap-3 border-t border-white/[0.06] pt-3"><span className="text-[#8f97aa]">更新时间</span><span className="text-right">{new Date(selectedAgent.updatedAt).toLocaleString('zh-CN')}</span></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center p-8 text-center text-[#8f97aa]">
              <div>
                <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-50" />
                <div className="text-sm">还没有智能体，点击“新建智能体”开始创建。</div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
