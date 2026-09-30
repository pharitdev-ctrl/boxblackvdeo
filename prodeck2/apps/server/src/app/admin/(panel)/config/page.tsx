import { configFormValues } from "../../../../lib/admin-forms.ts"
import { requireAdmin } from "../../../../lib/admin-session.ts"
import { getConfig } from "../../../../lib/config-store.ts"
import { database } from "../../../../lib/database.ts"
import { ConfigForm } from "./config-form.tsx"

export default async function ConfigPage() {
  await requireAdmin()
  const values = configFormValues(await getConfig(await database()))
  return (
    <>
      <header className="page-head">
        <div>
          <h1>config ของแอป</h1>
          <p className="muted">ส่งไปทุกเครื่องพร้อม token ครั้งถัดไปที่แอปติดต่อ server (ไม่เกิน 12 ชั่วโมง)</p>
        </div>
      </header>
      <ConfigForm values={values} />
    </>
  )
}
