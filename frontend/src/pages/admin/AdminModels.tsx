import Settings from "../settings/Settings";

export default function AdminModels() {
  return (
    <Settings
      embedded
      scope="admin"
      hideBackButton
      initialView="routing"
      title="模型管理"
      subtitle="在后台统一管理模型供应商、模型列表，以及前台可选择的默认模型。"
    />
  );
}
