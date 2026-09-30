import Link from "next/link"
import type { ReactNode } from "react"
import { requireAdmin } from "../../../lib/admin-session.ts"
import { logout } from "../actions.ts"

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireAdmin()
  return (
    <div className="panel">
      <nav className="nav">
        <strong>BOXBLACK</strong>
        <Link href="/admin">license</Link>
        <Link href="/admin/licenses/new">ออก key ใหม่</Link>
        <Link href="/admin/config">config ของแอป</Link>
        <form action={logout} className="nav-end">
          <button className="link">ออกจากระบบ</button>
        </form>
      </nav>
      <main className="content">{children}</main>
    </div>
  )
}
