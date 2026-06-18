# Admin System Source Package

这个包是从当前项目中整理出来的后台管理系统源码，用于迁移或复用到其他项目。

## 包含内容

- `frontend/src/pages/admin`: 后台页面，包括用户、积分套餐、兑换码、模型积分、模型管理、风格库、作品、智能体、邮箱、对象存储、系统日志、管理员设置。
- `frontend/src/pages/settings`: 后台模型管理页复用了这里的 `Settings` 组件。
- `frontend/src/store`: 后台相关 Zustand store，包括管理员登录、用户、积分、模型、模型积分、首页内容等。
- `frontend/src/lib`: 后台依赖的路由、模型、存储同步、密码哈希、工具函数等。
- `frontend/src/services`: 后台依赖的接口服务，如日志、样式库、对象存储、邮箱、智能体等。
- `frontend/src/components/ui`: 后台页面使用的基础 UI 组件。
- `frontend/src/main.tsx`: 已整理成只包含后台路由的独立入口示例。
- `backend/src/server.ts`: 当前项目后端源码，后台 API 目前集中在这个文件内。

## 未包含内容

没有包含以下运行产物或可能包含敏感信息的目录：

- `node_modules`
- `dist`
- `data`
- `logs`
- `uploads`
- `.env`

## 前端接入

后台入口路径在：

```ts
frontend/src/lib/adminRoutes.ts
```

当前后台真实路径是 `ADMIN_BASE_PATH`，登录页路径是 `ADMIN_LOGIN_PATH`。

包内已经提供了一个只挂载后台管理系统的入口：

```ts
frontend/src/main.tsx
```

核心路由结构如下，可按目标项目需要调整：

```tsx
import { Navigate, createBrowserRouter } from "react-router-dom";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminHomeContent from "./pages/admin/AdminHomeContent";
import AdminPackages from "./pages/admin/AdminPackages";
import AdminRedeemCodes from "./pages/admin/AdminRedeemCodes";
import AdminModelCredits from "./pages/admin/AdminModelCredits";
import AdminCategories from "./pages/admin/AdminCategories";
import AdminStyles from "./pages/admin/AdminStyles";
import AdminWorks from "./pages/admin/AdminWorks";
import AdminModels from "./pages/admin/AdminModels";
import AdminAgents from "./pages/admin/AdminAgents";
import AdminEmailSettings from "./pages/admin/AdminEmailSettings";
import AdminStorage from "./pages/admin/AdminStorage";
import AdminLogs from "./pages/admin/AdminLogs";
import AdminSettings from "./pages/admin/AdminSettings";
import { ADMIN_BASE_PATH, ADMIN_LOGIN_PATH, adminPath } from "./lib/adminRoutes";

export const router = createBrowserRouter([
  { path: ADMIN_LOGIN_PATH, element: <AdminLogin /> },
  {
    path: ADMIN_BASE_PATH,
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to={adminPath("home-content")} replace /> },
      { path: "users", element: <AdminUsers /> },
      { path: "home-content", element: <AdminHomeContent /> },
      { path: "packages", element: <AdminPackages /> },
      { path: "redeem-codes", element: <AdminRedeemCodes /> },
      { path: "model-credits", element: <AdminModelCredits /> },
      { path: "categories", element: <AdminCategories /> },
      { path: "styles", element: <AdminStyles /> },
      { path: "works", element: <AdminWorks /> },
      { path: "models", element: <AdminModels /> },
      { path: "agents", element: <AdminAgents /> },
      { path: "email", element: <AdminEmailSettings /> },
      { path: "storage", element: <AdminStorage /> },
      { path: "logs", element: <AdminLogs /> },
      { path: "settings", element: <AdminSettings /> },
    ],
  },
]);
```

如果需要多标签页/多客户端同步后台状态，把 `SharedStoreSync` 挂在 React 根组件附近。

## 后端接入

后台 API 目前在 `backend/src/server.ts` 里，主要包括：

- `/api/app-state/:key`: 前后端共享状态持久化。
- `/api/admin/style-library`
- `/api/admin/style-categories`
- `/api/admin/styles`
- `/api/admin/storage-config`
- `/api/admin/storage-test`
- `/api/admin/storage-objects`
- `/api/admin/storage-presign-upload`
- `/api/admin/logs`
- 邮箱配置、智能体、上传、对象存储等接口也在同一个后端文件里。

迁移时可以先整体接入 `server.ts`，再按业务拆分为独立 router。

## 默认账号

默认管理员账号在：

```ts
frontend/src/store/adminAuthStore.ts
```

默认值为 `admin / admin123`。迁移到生产环境前建议改成服务端鉴权，或至少首次部署后立即修改账号密码。

## 依赖

前端核心依赖：React、React Router、Zustand、Lucide、Tailwind。

后端核心依赖：Express、Multer、Nodemailer、AWS S3 SDK。
