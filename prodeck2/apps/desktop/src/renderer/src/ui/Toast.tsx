import { createContext, useContext, useEffect } from "react"
import { createPortal } from "react-dom"
import { Button } from "./Button.tsx"
import { Mascot, type MascotPose } from "./Mascot.tsx"

export interface ToastProps {
  message: string
  action?: { label: string; onClick: () => void }
  onDone: () => void
  ms?: number
  /** the mascot beside the words, when what happened is one it has a face for */
  pose?: MascotPose
}

/** Where the app gathers its toasts, one above the other; without one a toast stands at the foot of the window alone. */
export const ToastStack = createContext<HTMLElement | null>(null)

/** A line at the foot of the window that says what just happened, then goes away. */
export function Toast({ message, action, onDone, ms = 6000, pose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDone, ms)
    return () => clearTimeout(timer)
  }, [message, ms, onDone])

  const stack = useContext(ToastStack)
  const toast = (
    <div className="toast" role="status">
      {pose && <Mascot pose={pose} size={40} />}
      <span>{message}</span>
      {action && (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
  return stack ? createPortal(toast, stack) : toast
}
