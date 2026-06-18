import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router-dom";
import { SharedStoreSync } from "./components/SharedStoreSync";
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
import AdminLogs from "./pages/admin/AdminLogs";
import AdminStorage from "./pages/admin/AdminStorage";
import { ADMIN_BASE_PATH, ADMIN_LOGIN_PATH, adminPath } from "./lib/adminRoutes";
import "./index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to={ADMIN_BASE_PATH} replace />,
  },
  {
    path: ADMIN_LOGIN_PATH,
    element: <AdminLogin />,
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
    path: "*",
    element: <Navigate to={ADMIN_BASE_PATH} replace />,
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SharedStoreSync />
    <RouterProvider router={router} />
  </StrictMode>
);

