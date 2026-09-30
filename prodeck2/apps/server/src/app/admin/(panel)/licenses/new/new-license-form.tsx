"use client"

import Link from "next/link"
import { useActionState } from "react"
import { createLicenseAction, type CreateState } from "../../../actions.ts"

export function NewLicenseForm() {
  const [state, action, pending] = useActionState<CreateState, FormData>(createLicenseAction, { error: null, created: null })

  if (state.created) {
    return (
      <section className="card stack">
        <h2>ออก key ให้ {state.created.customer} แล้ว</h2>
        <p>ส่ง key นี้ให้ลูกค้า — ระบบเก็บไว้แบบเข้ารหัสทางเดียว <strong>จะไม่แสดงอีก</strong> ถ้าทำหายต้องออกใหม่</p>
        <code className="key">{state.created.key}</code>
        <div className="row">
          <Link href={`/admin/licenses/${state.created.id}`}>ไปที่ license นี้</Link>
          {/* a full load clears the form state, and the key with it */}
          <a href="/admin/licenses/new">ออก key อีก</a>
        </div>
      </section>
    )
  }

  return (
    <form action={action} className="card stack narrow">
      <label className="field">
        <span>ชื่อลูกค้า</span>
        <input name="customer" required />
      </label>
      <label className="field">
        <span>อีเมล (ไม่บังคับ)</span>
        <input name="email" type="email" />
      </label>
      <div className="row">
        <label className="field">
          <span>แผน</span>
          <select name="plan" defaultValue="monthly">
            <option value="monthly">รายเดือน</option>
            <option value="yearly">รายปี</option>
          </select>
        </label>
        <label className="field">
          <span>จำนวนเครื่อง</span>
          <input name="maxDevices" type="number" min={1} max={20} defaultValue={2} required />
        </label>
        <label className="field">
          <span>หมดอายุ (เว้นว่าง = อีก 1 เดือน/ปีตามแผน)</span>
          <input name="expiresOn" type="date" />
        </label>
      </div>
      <label className="field">
        <span>บันทึก (ไม่บังคับ)</span>
        <textarea name="note" rows={2} />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button className="primary" disabled={pending}>
        {pending ? "กำลังออก key…" : "ออก key"}
      </button>
    </form>
  )
}
