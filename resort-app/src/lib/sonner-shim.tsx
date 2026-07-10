// Aliased in vite.config.ts so every `import { toast } from "sonner"` across
// the app (54 call sites) resolves here instead of the real sonner package —
// keeps the exact same imperative call shape while rendering through Carbon's
// ToastNotification (see src/components/ui/sonner.tsx for the <Toaster/>).
import { pushToast, dismissToast } from "@/lib/toast-store"

interface ToastOptions {
  description?: string
}

interface PromiseMessages<T> {
  loading: string
  success: string | ((value: T) => string)
  error: string | ((error: unknown) => string)
}

function resolveMessage<T>(
  message: string | ((value: T) => string),
  value: T
): string {
  return typeof message === "function" ? message(value) : message
}

function toast(title: string, options?: ToastOptions) {
  return pushToast("info", title, options)
}

toast.success = (title: string, options?: ToastOptions) =>
  pushToast("success", title, options)

toast.error = (title: string, options?: ToastOptions) =>
  pushToast("error", title, options)

toast.info = (title: string, options?: ToastOptions) =>
  pushToast("info", title, options)

toast.warning = (title: string, options?: ToastOptions) =>
  pushToast("warning", title, options)

toast.promise = <T,>(promise: Promise<T>, messages: PromiseMessages<T>) => {
  const loadingId = pushToast("info", messages.loading)
  promise.then(
    (value) => {
      dismissToast(loadingId)
      pushToast("success", resolveMessage(messages.success, value))
    },
    (error) => {
      dismissToast(loadingId)
      pushToast("error", resolveMessage(messages.error, error))
    }
  )
  return promise
}

export { toast }
