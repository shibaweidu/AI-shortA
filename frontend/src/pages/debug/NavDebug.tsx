import { useSiteContentStore, hasRenderableSitePage, normalizeSiteNavItem } from "../../store/siteContentStore";

export default function NavDebug() {
  const { customNavItems } = useSiteContentStore();

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <h1 className="text-2xl font-bold">自定义导航调试信息</h1>

      <div className="mt-8 space-y-4">
        <div className="rounded-lg border border-white/20 bg-white/5 p-4">
          <h2 className="text-lg font-semibold">原始数据 (customNavItems.length: {customNavItems.length})</h2>
          <pre className="mt-2 overflow-auto text-xs text-gray-300">
            {JSON.stringify(customNavItems, null, 2)}
          </pre>
        </div>

        <div className="rounded-lg border border-white/20 bg-white/5 p-4">
          <h2 className="text-lg font-semibold">标准化后的数据</h2>
          <div className="mt-2 space-y-2">
            {customNavItems.map(normalizeSiteNavItem).map((item, index) => (
              <div key={item.id} className="rounded border border-white/10 bg-white/5 p-3">
                <div className="text-sm">
                  <strong>#{index + 1}</strong> - ID: {item.id}
                </div>
                <div className="text-sm">Label: {item.label}</div>
                <div className="text-sm">PageTitle: {item.pageTitle}</div>
                <div className="text-sm">Enabled: {String(item.enabled)}</div>
                <div className="text-sm">
                  Has richContent: {item.richContent ? 'Yes' : 'No'}
                  {item.richContent ? ` (length: ${item.richContent.length})` : ''}
                </div>
                <div className="text-sm">Blocks: {item.blocks.length}</div>
                <div className="text-sm font-bold">
                  hasRenderableSitePage: {String(hasRenderableSitePage(item))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/20 bg-white/5 p-4">
          <h2 className="text-lg font-semibold">可渲染的页面</h2>
          <div className="mt-2 space-y-2">
            {customNavItems
              .map(normalizeSiteNavItem)
              .filter(hasRenderableSitePage)
              .map((item) => (
                <div key={item.id} className="rounded border border-green-500/30 bg-green-500/10 p-3">
                  <div className="text-sm">
                    <strong>{item.label}</strong> - /pages/{item.id}
                  </div>
                </div>
              ))}
            {customNavItems.map(normalizeSiteNavItem).filter(hasRenderableSitePage).length === 0 && (
              <div className="text-sm text-red-400">没有可渲染的页面</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
