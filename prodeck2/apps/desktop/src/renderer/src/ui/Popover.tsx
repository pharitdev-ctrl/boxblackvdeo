import { useEffect, useRef, type ReactNode } from "react"

export interface PopoverProps {
  open: boolean
  label: string
  onClose: () => void
  children: ReactNode
  /** which side of its box it hangs from; the caller's box must be positioned */
  align?: "left" | "right"
}

/** A small panel hanging off the control that opened it. Escape or a click elsewhere closes it. */
export function Popover({ open, label, onClose, children, align = "right" }: PopoverProps) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    const onDown = (event: PointerEvent) => {
      if (box.current?.contains(event.target as Node)) return
      // the button that opened it toggles it itself; closing here too would open it again on the click
      const opener = (event.target as Element).closest?.("[aria-expanded]")
      if (opener && opener.parentElement === box.current?.parentElement) return
      onClose()
    }
    window.addEventListener("keydown", onKey)
    // capture, so a click that opens another popover closes this one first
    window.addEventListener("pointerdown", onDown, true)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onDown, true)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className={`popover ${align}`} role="group" aria-label={label} ref={box}>
      {children}
    </div>
  )
}
