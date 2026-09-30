import Link from "next/link"
import { formatThaiDate } from "../../../lib/admin-forms.ts"
import { requireAdmin } from "../../../lib/admin-session.ts"
import { database } from "../../../lib/database.ts"
import { PLAN_LABEL, STATUS_LABEL } from "../../../lib/labels.ts"
import { listLicenses } from "../../../lib/licenses.ts"

export default async function LicensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin()
  const q = (await searchParams).q
  const search = typeof q === "string" ? q : ""
  const licenses = await listLicenses(await database(), { now: Date.now(), search })

  return (
    <>
      <header className="page-head">
        <h1>license ทั้งหมด</h1>
        <form className="search">
          <input name="q" defaultValue={search} placeholder="ค้นชื่อลูกค้า อีเมล หรือท้าย key" aria-label="ค้นหา" />
          <button>ค้นหา</button>
        </form>
      </header>
      {licenses.length === 0 ? (
        <p className="muted">{search ? "ไม่พบ license ที่ตรงกับคำค้น" : "ยังไม่มี license — กด “ออก key ใหม่”"}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ลูกค้า</th>
              <th>key</th>
              <th>แผน</th>
              <th>หมดอายุ</th>
              <th>เครื่อง</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((license) => (
              <tr key={license.id}>
                <td>
                  <Link href={`/admin/licenses/${license.id}`}>{license.customer}</Link>
                  {license.email && <div className="muted">{license.email}</div>}
                </td>
                <td className="mono">…{license.keyHint}</td>
                <td>{PLAN_LABEL[license.plan]}</td>
                <td>{formatThaiDate(license.expiresAt)}</td>
                <td>
                  {license.devicesUsed} / {license.maxDevices}
                </td>
                <td>
                  <span className={`badge ${license.status}`}>{STATUS_LABEL[license.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
