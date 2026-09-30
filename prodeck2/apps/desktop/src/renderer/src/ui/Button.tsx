import type { ButtonHTMLAttributes } from "react"

type Variant = "default" | "primary" | "ghost" | "ai"
type Size = "md" | "sm" | "xs"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

/** Every button in the app. `type` defaults to "button" so one inside a form does not submit it. */
export function Button({ variant = "default", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button {...rest} type={type} className={["btn", variant, size, className].filter(Boolean).join(" ")} />
}
