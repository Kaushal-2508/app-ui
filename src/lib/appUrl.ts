export function getAppUrl(): string {
  const envUrl = import.meta.env.VITE_PUBLIC_URL as string | undefined;
  if (envUrl) return envUrl.trim().replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function buildAppUrl(path: string): string {
  const base = getAppUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
