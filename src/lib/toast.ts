import { toast as sonnerToast } from "sonner";
import { translateError } from "./errorMessages";

type ToastOptions = {
  fallback?: string;
  context?: string;
};

export function toastError(err: unknown, options: ToastOptions = {}) {
  const { fallback = "Something went wrong.", context } = options;
  const translated = translateError(err, fallback);

  if (typeof window !== "undefined" && err) {
    const prefix = context ? `[${context}]` : "[error]";
    console.error(prefix, err);
  }

  const description = translated.ref
    ? translated.description
      ? `${translated.description} (Ref: ${translated.ref})`
      : `Ref: ${translated.ref}`
    : translated.description;

  sonnerToast.error(translated.title, description ? { description } : undefined);
  return translated;
}

export function toastSuccess(title: string, description?: string) {
  sonnerToast.success(title, description ? { description } : undefined);
}

export function toastInfo(title: string, description?: string) {
  sonnerToast.message(title, description ? { description } : undefined);
}

export function toastWarning(title: string, description?: string) {
  sonnerToast.warning(title, description ? { description } : undefined);
}

export { sonnerToast as toast };
