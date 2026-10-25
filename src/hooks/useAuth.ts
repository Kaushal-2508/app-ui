// Auth state is owned by a single AuthProvider mounted above BrowserRouter in
// App.tsx (see src/contexts/AuthContext.tsx). This module stays as the import
// path every consumer already uses. Before the provider existed, useAuth() was
// a plain hook that started with `loading = true` on every mount; because
// ProtectedRoute wraps every route individually, each navigation remounted it
// and flashed the full-page skeleton until `getSession()` resolved.
//
// A redirect-to-login hook used to live here too; it had no consumers
// (ProtectedRoute does that job) and was removed on 2026-10-05 (Task 8).
export { useAuth } from "@/contexts/AuthContext";
export type { PasswordStatus } from "@/contexts/AuthContext";
