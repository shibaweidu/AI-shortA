import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useSiteContentStore } from "../../store/siteContentStore";

export default function AdminHomeContent() {
  const { homeTitle, homeHighlight, homeSubtitle, setHomeContent } = useSiteContentStore();
  const [title, setTitle] = useState(homeTitle);
  const [highlight, setHighlight] = useState(homeHighlight);
  const [subtitle, setSubtitle] = useState(homeSubtitle);
  const [message, setMessage] = useState("");

  const save = () => {
    setHomeContent({ homeTitle: title, homeHighlight: highlight, homeSubtitle: subtitle });
    setMessage("首页文案已保存。");
  };

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">首页文案</h1>
        <p className="mt-2 text-sm text-[#8f97aa]">配置首页顶部标题高亮文字和副标题。</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[520px_1fr]">
        <section className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-5">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white">标题文本</label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
              <div className="text-xs text-[#8f97aa]">用一个空格位置承载高亮文字，例如：开启你的 ，立即开始创作。</div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white">高亮文字</label>
              <Input value={highlight} onChange={(event) => setHighlight(event.target.value)} className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white">副标题</label>
              <Input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
            </div>
            <Button type="button" onClick={save} className="h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
              <Save className="mr-2 h-4 w-4" />
              保存文案
            </Button>
            {message ? <div className="text-sm text-emerald-300">{message}</div> : null}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-8">
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-300/70">Preview</div>
          <div className="mt-5 text-[34px] font-bold tracking-tight text-white">
            {title.split(" ")[0] || title}
            {title.includes(" ") ? <span className="text-[#10c8ff]"> {highlight} </span> : null}
            {title.split(" ").slice(1).join(" ")}
          </div>
          <p className="mt-5 text-base text-white/60">{subtitle}</p>
        </section>
      </div>
    </div>
  );
}
