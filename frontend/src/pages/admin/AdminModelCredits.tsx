import { useMemo } from "react";
import { Coins, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { buildModelCatalogOptions } from "../../lib/modelCatalog";
import { IMAGE_RESOLUTION_OPTIONS, VIDEO_DURATION_OPTIONS } from "../../lib/generatorOptions";
import { useModelCreditStore } from "../../store/modelCreditStore";
import { useSettingsStore } from "../../store/settingsStore";

const inputClass = "h-9 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]";

export default function AdminModelCredits() {
  const { providers, routing } = useSettingsStore();
  const { rules, setImageCredits, setVideoCredits, clearRule } = useModelCreditStore();

  const imageModels = useMemo(() => buildModelCatalogOptions(providers, routing, "image"), [providers, routing]);
  const videoModels = useMemo(() => buildModelCatalogOptions(providers, routing, "video"), [providers, routing]);

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">模型积分设置</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#8f97aa]">
            为同一个模型配置不同图片分辨率、视频时长下的消耗积分。未配置的项目会回退使用模型管理里的默认“消耗积分”。
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-3 text-center">
          <div className="text-2xl font-semibold text-white">{rules.length}</div>
          <div className="text-xs text-[#8f97aa]">已配置规则</div>
        </div>
      </div>

      <section className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-5">
        <div className="mb-5 flex items-center gap-3">
          <Coins className="h-5 w-5 text-cyan-300" />
          <h2 className="text-lg font-semibold">图片模型积分</h2>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
          {imageModels.length ? (
            imageModels.map((model) => {
              const rule = rules.find((item) => item.modelValue === model.value);
              return (
                <div key={model.value} className="border-b border-white/[0.06] p-4 last:border-b-0">
                  <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="font-medium text-white">{model.label}</div>
                      <div className="mt-1 text-xs text-[#8f97aa]">{model.providerName} · 默认 {model.credits ?? 0} 积分</div>
                    </div>
                    <Button type="button" onClick={() => clearRule(model.value)} className="h-9 rounded-xl bg-white/[0.06] px-3 text-xs text-white hover:bg-white/[0.10]">
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                      清空规则
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {IMAGE_RESOLUTION_OPTIONS.map((option) => (
                      <label key={option.value} className="block rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                        <div className="mb-2 text-xs text-[#9aa3b7]">{option.label}</div>
                        <Input
                          type="number"
                          min={0}
                          value={rule?.imageCreditsByResolution[option.value] ?? ""}
                          onChange={(event) => setImageCredits(model.value, option.value, Number(event.target.value))}
                          placeholder={`${model.credits ?? 0}`}
                          className={inputClass}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-4 py-8 text-center text-sm text-[#8f97aa]">暂无图片模型，请先到模型管理添加并启用模型。</div>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-[28px] border border-white/[0.08] bg-[#11141b] p-5">
        <div className="mb-5 flex items-center gap-3">
          <Coins className="h-5 w-5 text-amber-300" />
          <h2 className="text-lg font-semibold">视频模型积分</h2>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
          {videoModels.length ? (
            videoModels.map((model) => {
              const rule = rules.find((item) => item.modelValue === model.value);
              return (
                <div key={model.value} className="border-b border-white/[0.06] p-4 last:border-b-0">
                  <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="font-medium text-white">{model.label}</div>
                      <div className="mt-1 text-xs text-[#8f97aa]">{model.providerName} · 默认 {model.credits ?? 0} 积分</div>
                    </div>
                    <Button type="button" onClick={() => clearRule(model.value)} className="h-9 rounded-xl bg-white/[0.06] px-3 text-xs text-white hover:bg-white/[0.10]">
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                      清空规则
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {VIDEO_DURATION_OPTIONS.map((option) => (
                      <label key={option.value} className="block rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                        <div className="mb-2 text-xs text-[#9aa3b7]">{option.label}</div>
                        <Input
                          type="number"
                          min={0}
                          value={rule?.videoCreditsByDuration[option.value] ?? ""}
                          onChange={(event) => setVideoCredits(model.value, option.value, Number(event.target.value))}
                          placeholder={`${model.credits ?? 0}`}
                          className={inputClass}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-4 py-8 text-center text-sm text-[#8f97aa]">暂无视频模型，请先到模型管理添加并启用模型。</div>
          )}
        </div>
      </section>
    </div>
  );
}
