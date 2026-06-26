import { useEffect, useState } from "react";
import { CreditCard, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { DEFAULT_PAYMENT_SETTINGS, fetchPaymentSettings, updatePaymentSettings, type PaymentSettings } from "../../services/payment";

const inputClass = "h-10 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]";
const textareaClass = "min-h-[120px] w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-[#667085]";

export default function AdminPayment() {
  const [settings, setSettings] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchPaymentSettings().then(setSettings).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      JSON.parse(settings.headersJson || "{}");
      JSON.parse(settings.payloadTemplate || "{}");
      const saved = await updatePaymentSettings(settings);
      setSettings(saved);
      setMessage("支付配置已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">支付接入</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#8f97aa]">
            配置通用创建订单接口。用户购买积分套餐时，系统会通过后端代理请求支付商并跳转返回的支付链接。
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd7e6]">
          {settings.enabled ? "已启用" : "未启用"}
        </div>
      </div>

      <section className="max-w-4xl rounded-[28px] border border-white/[0.08] bg-[#11141b] p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-white">支付系统配置</div>
            <div className="mt-1 text-xs text-[#8f97aa]">支持外部购买链接或后端 API 创建订单。</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-[#d5d9e2]">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
              className="accent-cyan-400"
            />
            启用支付入口
          </label>
          <select
            value={settings.mode}
            onChange={(event) => setSettings((current) => ({ ...current, mode: event.target.value === "api" ? "api" : "external" }))}
            className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none"
          >
            <option value="external" className="bg-[#111318]">使用套餐购买链接</option>
            <option value="api" className="bg-[#111318]">后端 API 创建订单</option>
          </select>
          <Input value={settings.providerName} onChange={(event) => setSettings((current) => ({ ...current, providerName: event.target.value }))} placeholder="支付商名称，例如 Stripe / 支付宝 / 微信支付" className={inputClass} />
          <select
            value={settings.method}
            onChange={(event) => setSettings((current) => ({ ...current, method: event.target.value === "GET" ? "GET" : "POST" }))}
            className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none"
          >
            <option value="POST" className="bg-[#111318]">POST</option>
            <option value="GET" className="bg-[#111318]">GET</option>
          </select>
          <Input value={settings.createOrderUrl} onChange={(event) => setSettings((current) => ({ ...current, createOrderUrl: event.target.value }))} placeholder="创建订单接口 URL" className="md:col-span-2 h-10 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
          <Input value={settings.payUrlField} onChange={(event) => setSettings((current) => ({ ...current, payUrlField: event.target.value }))} placeholder="支付链接字段，例如 payUrl 或 data.pay_url" className={inputClass} />
          <Input value={settings.orderIdField} onChange={(event) => setSettings((current) => ({ ...current, orderIdField: event.target.value }))} placeholder="订单号字段，例如 orderId 或 data.id" className={inputClass} />
          <Input type="password" value={settings.webhookSecret} onChange={(event) => setSettings((current) => ({ ...current, webhookSecret: event.target.value }))} placeholder="回调密钥，用于 /api/payments/fulfill" className={inputClass} />
          <Input value={settings.successUrl} onChange={(event) => setSettings((current) => ({ ...current, successUrl: event.target.value }))} placeholder="支付成功跳转 URL，可留空" className={inputClass} />
          <Input value={settings.cancelUrl} onChange={(event) => setSettings((current) => ({ ...current, cancelUrl: event.target.value }))} placeholder="取消支付跳转 URL，可留空" className={inputClass} />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm text-[#cfd7e6]">请求头 JSON</span>
            <textarea value={settings.headersJson} onChange={(event) => setSettings((current) => ({ ...current, headersJson: event.target.value }))} placeholder='{"Authorization":"Bearer sk_xxx"}' className={textareaClass} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-[#cfd7e6]">请求体模板 JSON</span>
            <textarea value={settings.payloadTemplate} onChange={(event) => setSettings((current) => ({ ...current, payloadTemplate: event.target.value }))} className={textareaClass} />
          </label>
        </div>

        {message ? <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-[#d5d9e2]">{message}</div> : null}
        <Button type="button" onClick={() => void save()} disabled={saving} className="mt-5 h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
          <Save className="mr-2 h-4 w-4" />
          保存支付配置
        </Button>
      </section>
    </div>
  );
}
