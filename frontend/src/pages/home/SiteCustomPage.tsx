import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { getDisplayAssetUrl } from "../../lib/utils";
import { hasRenderableSitePage, normalizeSiteNavItem, useSiteContentStore } from "../../store/siteContentStore";

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function SiteCustomPage() {
  const { pageId } = useParams();
  const { customNavItems } = useSiteContentStore();
  const page = customNavItems.map(normalizeSiteNavItem).find((item) => item.id === pageId && hasRenderableSitePage(item));

  if (!page) {
    return (
      <div className="min-h-full bg-[#08090d] px-4 py-10 text-white md:px-10">
        <div className="mx-auto max-w-3xl rounded-[28px] border border-white/[0.08] bg-[#11141b] p-8">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#8f97aa] transition hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </Link>
          <h1 className="mt-8 text-2xl font-semibold">页面不存在</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#8f97aa]">该自定义页面未启用，或内容已经被删除。</p>
        </div>
      </div>
    );
  }

  // 优先使用富文本内容
  const hasRichContent = page.richContent && page.richContent.trim();

  return (
    <div className="min-h-full bg-[#08090d] px-4 py-10 text-white md:px-10">
      <article className="mx-auto max-w-4xl rounded-[28px] border border-white/[0.08] bg-[#11141b] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#8f97aa] transition hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          返回首页
        </Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-white md:text-4xl">{page.pageTitle}</h1>

        {hasRichContent ? (
          <div
            className="prose-editor mt-8"
            dangerouslySetInnerHTML={{ __html: page.richContent || "" }}
          />
        ) : (
          <div className="mt-8 space-y-6">
            {page.blocks.map((block) => {
              if (block.type === "heading") {
                return <h2 key={block.id} className="pt-3 text-2xl font-semibold tracking-tight text-white">{block.text}</h2>;
              }
              if (block.type === "paragraph") {
                return <p key={block.id} className="whitespace-pre-line text-base leading-8 text-[#d5d9e2]">{block.text}</p>;
              }
              if (block.type === "image") {
                return (
                  <figure key={block.id} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0d12]">
                    <img src={getDisplayAssetUrl(block.url)} alt={block.name} className="max-h-[70vh] w-full object-contain" />
                    {block.name ? <figcaption className="border-t border-white/[0.06] px-4 py-3 text-sm text-[#8f97aa]">{block.name}</figcaption> : null}
                  </figure>
                );
              }
              return (
                <a key={block.id} href={getDisplayAssetUrl(block.url)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-[#d5d9e2] transition hover:bg-white/[0.06] hover:text-white">
                  <FileText className="h-5 w-5 text-cyan-300" />
                  <span className="min-w-0 flex-1 truncate">{block.name}</span>
                  <span className="text-xs text-[#8f97aa]">{formatFileSize(block.size)}</span>
                </a>
              );
            })}
          </div>
        )}
      </article>
    </div>
  );
}
