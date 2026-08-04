// Minimal imperative toast queue, shared between the <Toaster/>
// (src/components/ui/sonner.tsx) and the sonner-API shim
// (src/lib/sonner-shim.tsx) that every call site's `toast.success(...)` etc.
// gets aliased to (see vite.config.ts resolve.alias for "sonner").
export type ToastKind = "success" | "error" | "info" | "warning"

export interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  subtitle?: string
  timeout: number
}

let items: ToastItem[] = []
let listeners: Array<(items: ToastItem[]) => void> = []
let nextId = 1

function emit() {
  listeners.forEach((listener) => listener(items))
}

export function pushToast(
  kind: ToastKind,
  title: string,
  options?: { description?: string }
): number {
  const id = nextId++
  items = [
    ...items,
    {
      id,
      kind,
      title,
      subtitle: options?.description,
      timeout: kind === "error" ? 6000 : 4000,
    },
  ]
  emit()
  return id
}

export function dismissToast(id: number) {
  items = items.filter((item) => item.id !== id)
  emit()
}

export function subscribeToasts(listener: (items: ToastItem[]) => void) {
  listeners.push(listener)
  listener(items)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}
