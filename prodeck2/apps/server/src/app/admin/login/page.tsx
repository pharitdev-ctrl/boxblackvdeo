import { redirect } from "next/navigation"
import { isAdmin } from "../../../lib/admin-session.ts"
import { LoginForm } from "./login-form.tsx"

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin")
  return (
    <main className="login">
      <h1>BOXBLACK · ผู้ดูแล license</h1>
      <LoginForm />
    </main>
  )
}
