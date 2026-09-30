import { requireAdmin } from "../../../../../lib/admin-session.ts"
import { NewLicenseForm } from "./new-license-form.tsx"

export default async function NewLicensePage() {
  await requireAdmin()
  return (
    <>
      <header className="page-head">
        <h1>ออก key ใหม่</h1>
      </header>
      <NewLicenseForm />
    </>
  )
}
