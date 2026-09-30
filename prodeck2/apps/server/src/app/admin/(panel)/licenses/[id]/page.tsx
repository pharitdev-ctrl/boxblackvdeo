import Link from "next/link"
import { notFound } from "next/navigation"
import { dateInputValue, formatThaiDate, formatThaiDateTime } from "../../../../../lib/admin-forms.ts"
import { requireAdmin } from "../../../../../lib/admin-session.ts"
import { database } from "../../../../../lib/database.ts"
import { getLicense } from "../../../../../lib/licenses.ts"
import { releaseDeviceAction, renewLicenseAction, revokeLicenseAction, updateLicenseAction } from "../../../actions.ts"
import { PLAN_LABEL, STATUS_LABEL } from "../../../../../lib/labels.ts"
import { ConfirmButton } from "./confirm-button.tsx"

export default async function LicensePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const license = await getLicense(await database(), (await params).id, Date.now())
  if (!license) notFound()

  return (
    <>
      <header className="page-head">
        <div>
          <Link href="/admin" className="muted">
            ‹ license ทั้งหมด
          </Link>
          <h1>{license.customer}</h1>
          <p className="muted">
            key …<span className="mono">{license.keyHint}</span> · {PLAN_LABEL[license.plan]} · ออกเมื่อ {formatThaiDate(license.createdAt)}
          </p>
        </div>
        <span className={`badge ${license.status}`}>{STATUS_LABEL[license.status]}</span>
      </header>

      <section className="card stack">
        <h2>อายุ license</h2>
        <p>
          หมดอายุ <strong>{formatThaiDateTime(license.expiresAt)}</strong>
        </p>
        <div className="row">
          <form action={renewLicenseAction}>
            <input type="hidden" name="id" value={license.id} />
            <input type="hidden" name="by" value="month" />
            <button>ต่อ 1 เดือน</button>
          </form>
          <form action={renewLicenseAction}>
            <input type="hidden" name="id" value={license.id} />
            <input type="hidden" name="by" value="year" />
            <button>ต่อ 1 ปี</button>
          </form>
          <form action={renewLicenseAction} className="row">
            <input type="hidden" name="id" value={license.id} />
            <input name="expiresOn" type="date" defaultValue={dateInputValue(license.expiresAt)} required aria-label="วันหมดอายุ" />
            <button>ตั้งวันหมดอายุ</button>
          </form>
        </div>
        <form action={revokeLicenseAction}>
          <input type="hidden" name="id" value={license.id} />
          {license.revokedAt === null ? (
            <>
              <input type="hidden" name="revoke" value="true" />
              <ConfirmButton className="danger" message="ระงับ license นี้? ทุกเครื่องจะใช้งานไม่ได้เมื่อ token หมดอายุ (ไม่เกิน 3 วัน)">
                ระงับ license
              </ConfirmButton>
            </>
          ) : (
            <>
              <input type="hidden" name="revoke" value="false" />
              <p className="muted">ระงับเมื่อ {formatThaiDateTime(license.revokedAt)}</p>
              <button>ยกเลิกการระงับ</button>
            </>
          )}
        </form>
      </section>

      <section className="card stack">
        <h2>
          เครื่องที่ใช้งาน {license.devicesUsed} / {license.maxDevices}
        </h2>
        {license.activations.length === 0 ? (
          <p className="muted">ยังไม่มีเครื่องใดเปิดใช้งาน</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>เครื่อง</th>
                <th>เวอร์ชันแอป</th>
                <th>เปิดใช้เมื่อ</th>
                <th>ติดต่อล่าสุด</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {license.activations.map((activation) => (
                <tr key={activation.id} className={activation.releasedAt ? "released" : ""}>
                  <td>
                    {activation.deviceName || "ไม่ทราบชื่อ"}
                    <div className="muted mono">
                      {activation.platform} · {activation.deviceId.slice(0, 8)}
                    </div>
                  </td>
                  <td>{activation.appVersion}</td>
                  <td>{formatThaiDateTime(activation.createdAt)}</td>
                  <td>{formatThaiDateTime(activation.lastSeenAt)}</td>
                  <td>
                    {activation.releasedAt ? (
                      <span className="muted">ปลดแล้ว {formatThaiDate(activation.releasedAt)}</span>
                    ) : (
                      <form action={releaseDeviceAction}>
                        <input type="hidden" name="id" value={license.id} />
                        <input type="hidden" name="activationId" value={activation.id} />
                        <ConfirmButton message="ปลดเครื่องนี้? เครื่องนี้จะต้องใส่ key ใหม่ และที่ว่างจะให้เครื่องอื่นใช้ได้">ปลดเครื่อง</ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <form action={updateLicenseAction} className="card stack narrow">
        <h2>ข้อมูลลูกค้า</h2>
        <input type="hidden" name="id" value={license.id} />
        <label className="field">
          <span>ชื่อลูกค้า</span>
          <input name="customer" defaultValue={license.customer} required />
        </label>
        <label className="field">
          <span>อีเมล</span>
          <input name="email" type="email" defaultValue={license.email} />
        </label>
        <div className="row">
          <label className="field">
            <span>แผน</span>
            <select name="plan" defaultValue={license.plan}>
              <option value="monthly">รายเดือน</option>
              <option value="yearly">รายปี</option>
            </select>
          </label>
          <label className="field">
            <span>จำนวนเครื่อง</span>
            <input name="maxDevices" type="number" min={1} max={20} defaultValue={license.maxDevices} required />
          </label>
        </div>
        <label className="field">
          <span>บันทึก</span>
          <textarea name="note" rows={2} defaultValue={license.note} />
        </label>
        <button className="primary">บันทึก</button>
      </form>
    </>
  )
}
