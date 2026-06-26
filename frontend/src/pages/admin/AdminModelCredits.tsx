import { useMemo, useState } from "react";
import { ChevronDown, Coins, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { buildModelCatalogOptions, type ModelCatalogOption } from "../../lib/modelCatalog";
import { IMAGE_RESOLUTION_OPTIONS, type GeneratorOption } from "../../lib/generatorOptions";
import { findModelCreditRule, useModelCreditStore, type ModelCreditRule } from "../../store/modelCreditStore";
import { useSettingsStore } from "../../store/settingsStore";

const inputClass = "h-8 rounded-lg border-white/[0.08] bg-white/[0.035] px-2 text-sm text-white placeholder:text-[#667085]";
const VIDEO_CREDITS_PER_SECOND_OPTIONS: GeneratorOption[] = [{ value: "perSecond", label: "每秒" }];
const TEXT_CREDITS_PER_USE_OPTIONS: GeneratorOption[] = [{ value: "perUse", label: "每次" }];

type CreditSectionProps = {
  title: string;
  iconClassName: string;
  models: ModelCatalogOption[];
  options: GeneratorOption[];
  rules: ModelCreditRule[];
  emptyText: string;
  defaultText: (model: ModelCatalogOption) => string;
  getValue: (rule: ModelCreditRule | undefined, optionValue: string) => number | undefined;
  onChange: (modelValue: string, optionValue: string, credits: number) => void;
  onClear: (modelValue: string) => void;
};

function CreditSection({ title, iconClassName, models, options, rules, emptyText, defaultText, getValue, onChange, onClear }: CreditSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const gridTemplateColumns = `minmax(240px, 340px) repeat(${options.length}, 96px) 36px`;

  return (
    <section className="w-fit max-w-full rounded-2xl border border-white/[0.08] bg-[#11141b]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <Coins className={`h-4 w-4 ${iconClassName}`} />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-xs text-[#8f97aa]">{models.length} 个模型</span>
          <Button
            type="button"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `收起${title}` : `展开${title}`}
            title={isExpanded ? "收起" : "展开"}
            onClick={() => setIsExpanded((value) => !value)}
            className="h-8 w-8 rounded-lg bg-white/[0.06] p-0 text-white hover:bg-white/[0.10]"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </Button>
        </div>
      </div>

      {isExpanded ? (
        <div className="overflow-x-auto">
          {models.length ? (
            <div className="min-w-[620px]">
              <div
                className="grid items-center gap-2 border-b border-white/[0.06] bg-white/[0.025] px-4 py-2 text-xs font-medium text-[#8f97aa]"
                style={{ gridTemplateColumns }}
              >
                <div>模型</div>
                {options.map((option) => (
                  <div key={option.value}>{option.label}</div>
                ))}
                <div className="sr-only">操作</div>
              </div>

              {models.map((model) => {
                const rule = findModelCreditRule(rules, model.value);
                return (
                  <div
                    key={model.value}
                    className="grid items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 last:border-b-0 hover:bg-white/[0.025]"
                    style={{ gridTemplateColumns }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white">{model.label}</div>
                      <div className="mt-0.5 truncate text-xs text-[#8f97aa]">{model.providerName} · {defaultText(model)}</div>
                    </div>

                    {options.map((option) => (
                      <label key={option.value} className="block">
                        <span className="sr-only">{`${model.label} ${option.label} 积分`}</span>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={getValue(rule, option.value) ?? ""}
                          onChange={(event) => onChange(model.value, option.value, Number(event.target.value))}
                          placeholder="0"
                          className={inputClass}
                        />
                      </label>
                    ))}

                    <Button
                      type="button"
                      aria-label={`清空 ${model.label} 规则`}
                      title="清空规则"
                      onClick={() => onClear(model.value)}
                      className="h-8 w-8 rounded-lg bg-white/[0.06] p-0 text-white hover:bg-white/[0.10]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-[#8f97aa]">{emptyText}</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function AdminModelCredits() {
  const { providers, routing } = useSettingsStore();
  const { rules, setImageCredits, setVideoCreditsPerSecond, setTextCreditsPerUse, clearRule } = useModelCreditStore();

  const textModels = useMemo(() => buildModelCatalogOptions(providers, routing, "language"), [providers, routing]);
  const imageModels = useMemo(() => buildModelCatalogOptions(providers, routing, "image"), [providers, routing]);
  const videoModels = useMemo(() => buildModelCatalogOptions(providers, routing, "video"), [providers, routing]);

  return (
    <div className="min-h-full bg-[#08090d] p-4 text-white md:p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">模型积分设置</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[#8f97aa]">
            为文本模型配置每次消耗积分，为图片模型配置不同分辨率下的消耗积分；视频模型按每秒积分计算。未配置或设置为 0 时不消耗积分。
          </p>
        </div>
        <div className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3">
          <span className="text-lg font-semibold text-white">{rules.length}</span>
          <span className="text-xs text-[#8f97aa]">已配置规则</span>
        </div>
      </div>

      <div className="w-fit max-w-full space-y-4">
        <CreditSection
          title="文本模型每次积分"
          iconClassName="text-cyan-300"
          models={textModels}
          options={TEXT_CREDITS_PER_USE_OPTIONS}
          rules={rules}
          emptyText="暂无文本模型，请先到模型管理添加并启用模型。"
          defaultText={() => "未配置：0 积分/次"}
          getValue={(rule) => rule?.textCreditsPerUse}
          onChange={(modelValue, _optionValue, credits) => setTextCreditsPerUse(modelValue, credits)}
          onClear={clearRule}
        />

        <CreditSection
          title="图片模型积分"
          iconClassName="text-cyan-300"
          models={imageModels}
          options={IMAGE_RESOLUTION_OPTIONS}
          rules={rules}
          emptyText="暂无图片模型，请先到模型管理添加并启用模型。"
          defaultText={() => "未配置：0 积分"}
          getValue={(rule, optionValue) => rule?.imageCreditsByResolution[optionValue]}
          onChange={setImageCredits}
          onClear={clearRule}
        />

        <CreditSection
          title="视频模型每秒积分"
          iconClassName="text-cyan-300"
          models={videoModels}
          options={VIDEO_CREDITS_PER_SECOND_OPTIONS}
          rules={rules}
          emptyText="暂无视频模型，请先到模型管理添加并启用模型。"
          defaultText={() => "未配置：0 积分/秒"}
          getValue={(rule) => rule?.videoCreditsPerSecond}
          onChange={(modelValue, _optionValue, credits) => setVideoCreditsPerSecond(modelValue, credits)}
          onClear={clearRule}
        />
      </div>
    </div>
  );
}
