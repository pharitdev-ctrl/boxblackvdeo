"use client"

import { useActionState } from "react"
import { login, type FormState } from "../actions.ts"

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(login, { error: null })
  return (
    <form action={action} className="card stack">
      <label className="field">
        <span>รหัสผ่าน</span>
        <input name="password" type="password" autoComplete="current-password" required autoFocus />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button className="primary" disabled={pending}>
        {pending ? "กำลังตรวจ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  )
}
