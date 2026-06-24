import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { MainLayout } from "./components/layout/MainLayout";
import { RequireAuth } from "./components/RequireAuth";
import { SharedStoreSync } from "./components/SharedStoreSync";
import LandingHome from "./pages/home/LandingHome";
import SiteCustomPage from "./pages/home/SiteCustomPage";
import Auth from "./pages/auth/Auth";
import Profile from "./pages/profile/Profile";
import Flow from "./pages/flow/Flow";
import FlowProjects from "./pages/flow/FlowProjects";
import FlowWorkspace from "./pages/flow/FlowWorkspace";
import Settings from "./pages/settings/Settings";
import Credits from "./pages/credits/Credits";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminHomeContent from "./pages/admin/AdminHomeContent";
import AdminCategories from "./pages/admin/AdminCategories";
import AdminStyles from "./pages/admin/AdminStyles";
import AdminWorks from "./pages/admin/AdminWorks";
import AdminCollection from "./pages/admin/AdminCollection";
import AdminModels from "./pages/admin/AdminModels";
import AdminModelCredits from "./pages/admin/AdminModelCredits";
import AdminPackages from "./pages/admin/AdminPackages";
import AdminRedeemCodes from "./pages/admin/AdminRedeemCodes";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminAgents from "./pages/admin/AdminAgents";
import AdminEmailSettings from "./pages/admin/AdminEmailSettings";
import AdminLogs from "./pages/admin/AdminLogs";
import AdminStorage from "./pages/admin/AdminStorage";
import AdminData from "./pages/admin/AdminData";
import AgentCreate from "./pages/agent/AgentCreate";
import DiscoverWorkDetail from "./pages/discover/DiscoverWorkDetail";
import NavDebug from "./pages/debug/NavDebug";
import { ADMIN_BASE_PATH, ADMIN_LOGIN_PATH, adminPath } from "./lib/adminRoutes";
import "./index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: <LandingHome />,
      },
      {
        path: "projects",
        element: <RequireAuth><FlowProjects /></RequireAuth>,
      },
      {
        path: "flow",
        element: <Navigate to="/projects" replace />,
      },
      {
        path: "projects/:projectId",
        element: <RequireAuth><Flow /></RequireAuth>,
      },
      {
        path: "projects/:projectId/works/:itemId",
        element: <RequireAuth><FlowWorkspace /></RequireAuth>,
      },
      {
        path: "works/:itemId",
        element: <Navigate to="/projects" replace />,
      },
      {
        path: "settings",
        element: <RequireAuth><Settings /></RequireAuth>,
      },
      {
        path: "agents",
        element: <RequireAuth><AgentCreate /></RequireAuth>,
      },
      {
        path: "agents/create",
        element: <RequireAuth><AgentCreate /></RequireAuth>,
      },
      {
        path: "auth",
        element: <Auth />,
      },
      {
        path: "profile",
        element: <RequireAuth><Profile /></RequireAuth>,
      },
      {
        path: "credits",
        element: <RequireAuth><Credits /></RequireAuth>,
      },
      {
        path: "pages/:pageId",
        element: <SiteCustomPage />,
      },
      {
        path: "debug/nav",
        element: <NavDebug />,
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
  {
    path: ADMIN_LOGIN_PATH,
    element: <AdminLogin />,
  },
  {
    path: "/admin-login",
    element: <Navigate to="/" replace />,
  },
  {
    path: "/admin",
    element: <Navigate to="/" replace />,
  },
  {
    path: "/admin/*",
    element: <Navigate to="/" replace />,
  },
  {
    path: ADMIN_BASE_PATH,
    element: <AdminLayout />,
    children: [
      {
        index: true,
        element: <Navigate to={adminPath("home-content")} replace />,
      },
      {
        path: "users",
        element: <AdminUsers />,
      },
      {
        path: "home-content",
        element: <AdminHomeContent />,
      },
      {
        path: "packages",
        element: <AdminPackages />,
      },
      {
        path: "redeem-codes",
        element: <AdminRedeemCodes />,
      },
      {
        path: "model-credits",
        element: <AdminModelCredits />,
      },
      {
        path: "categories",
        element: <AdminCategories />,
      },
      {
        path: "styles",
        element: <AdminStyles />,
      },
      {
        path: "works",
        element: <AdminWorks />,
      },
      {
        path: "collection",
        element: <AdminCollection />,
      },
      {
        path: "models",
        element: <AdminModels />,
      },
      {
        path: "agents",
        element: <AdminAgents />,
      },
      {
        path: "email",
        element: <AdminEmailSettings />,
      },
      {
        path: "storage",
        element: <AdminStorage />,
      },
      {
        path: "data",
        element: <AdminData />,
      },
      {
        path: "logs",
        element: <AdminLogs />,
      },
      {
        path: "settings",
        element: <AdminSettings />,
      },
    ],
  },
  {
    path: "/discover/:workId",
    element: <DiscoverWorkDetail />,
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SharedStoreSync />
    <RouterProvider router={router} />
  </StrictMode>
);
