import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { currentUserId, hasHydrated } = useAuthStore();

  if (!hasHydrated) return null;
  if (!currentUserId) return <Navigate to="/auth" replace state={{ from: location }} />;

  return children;
}
