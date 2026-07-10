import * as React from "react"
import { ToastNotification } from "@carbon/react"
import { subscribeToasts, dismissToast, type ToastItem } from "@/lib/toast-store"

interface ToasterProps {
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left"
  // sonner-specific props kept for call-site compatibility; Carbon's
  // ToastNotification always shows a close button and kind-based color.
  richColors?: boolean
  closeButton?: boolean
}

const POSITION_STYLE: Record<NonNullable<ToasterProps["position"]>, React.CSSProperties> = {
  "top-right": { top: 16, right: 16 },
  "top-left": { top: 16, left: 16 },
  "bottom-right": { bottom: 16, right: 16 },
  "bottom-left": { bottom: 16, left: 16 },
}

const Toaster = ({ position = "top-right" }: ToasterProps) => {
  const [items, setItems] = React.useState<ToastItem[]>([])

  React.useEffect(() => subscribeToasts(setItems), [])

  return (
    <div
      style={{
        position: "fixed",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        ...POSITION_STYLE[position],
      }}
    >
      {items.map((item) => (
        <ToastNotification
          key={item.id}
          kind={item.kind}
          title={item.title}
          subtitle={item.subtitle}
          timeout={item.timeout}
          lowContrast
          onClose={() => dismissToast(item.id)}
        />
      ))}
    </div>
  )
}

export { Toaster }
