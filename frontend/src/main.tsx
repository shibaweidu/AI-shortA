import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { MainLayout } from "./components/layout/MainLayout";
import { SharedStoreSync } from "./components/SharedStoreSync";
import LandingHome from "./pages/home/LandingHome";
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
import AdminModels from "./pages/admin/AdminModels";
import AdminModelCredits from "./pages/admin/AdminModelCredits";
import AdminPackages from "./pages/admin/AdminPackages";
import AdminRedeemCodes from "./pages/admin/AdminRedeemCodes";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminAgents from "./pages/admin/AdminAgents";
import AdminEmailSettings from "./pages/admin/AdminEmailSettings";
import AgentCreate from "./pages/agent/AgentCreate";
import DiscoverWorkDetail from "./pages/discover/DiscoverWorkDetail";
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
        element: <FlowProjects />,
      },
      {
        path: "flow",
        element: <Navigate to="/projects" replace />,
      },
      {
        path: "projects/:projectId",
        element: <Flow />,
      },
      {
        path: "projects/:projectId/works/:itemId",
        element: <FlowWorkspace />,
      },
      {
        path: "works/:itemId",
        element: <Navigate to="/projects" replace />,
      },
      {
        path: "settings",
        element: <Settings />,
      },
      {
        path: "agents",
        element: <AgentCreate />,
      },
      {
        path: "agents/create",
        element: <AgentCreate />,
      },
      {
        path: "auth",
        element: <Auth />,
      },
      {
        path: "profile",
        element: <Profile />,
      },
      {
        path: "credits",
        element: <Credits />,
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
  {
    path: "/admin-login",
    element: <AdminLogin />,
  },
  {
    path: "/admin",
    element: <AdminLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/admin/home-content" replace />,
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
