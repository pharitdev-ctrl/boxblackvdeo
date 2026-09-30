"use client"

import { useActionState } from "react"
import { saveConfigAction, type ConfigState } from "../../actions.ts"

const PRESETS = [
  { id: "tight", label: "กระชับ" },
  { id: "normal", label: "ปกติ" },
  { id: "loose", label: "หลวม" },
] as const

export function ConfigForm({ values }: { values: Record<string, string> }) {
  const [state, action, pending] = useActionState<ConfigState, FormData>(saveConfigAction, { error: null, saved: false })
  return (
    <form action={action} className="stack">
      <section className="card stack narrow">
        <h2>CapCut ที่ทดสอบแล้ว</h2>
        <p className="muted">หนึ่งเวอร์ชันต่อบรรทัด · โปรเจคจากเวอร์ชันอื่นยังใช้ได้ แต่แอปจะเตือนก่อน</p>
        <textarea name="capcutVersions" rows={4} defaultValue={values.capcutVersions} className="mono" />
      </section>

      <section className="card stack">
        <h2>preset การตัด (วินาที)</h2>
        <table>
          <thead>
            <tr>
              <th>preset</th>
              <th>ช่วงเงียบยาวสุดที่เก็บไว้</th>
              <th>เว้นก่อนและหลังเสียงพูด</th>
            </tr>
          </thead>
          <tbody>
            {PRESETS.map((preset) => (
              <tr key={preset.id}>
                <td>{preset.label}</td>
                <td>
                  <input name={`${preset.id}.maxPause`} type="number" step="0.01" min="0.1" max="5" defaultValue={values[`${preset.id}.maxPause`]} required />
                </td>
                <td>
                  <input name={`${preset.id}.padding`} type="number" step="0.01" min="0" max="1" defaultValue={values[`${preset.id}.padding`]} required />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card stack">
        <h2>prompt</h2>
        <p className="muted">เว้นว่าง = ใช้ prompt ที่ติดมากับแอป · แก้ prompt แล้วแอปจะวิเคราะห์ภาพและวางโครงเรื่องใหม่ ไม่ใช้ผลเก่าที่เก็บไว้</p>
        <label className="field">
          <span>ทำความเข้าใจภาพ</span>
          <textarea name="visionPrompt" rows={8} defaultValue={values.visionPrompt} />
        </label>
        <label className="field">
          <span>วางโครงเรื่อง</span>
          <textarea name="plannerPrompt" rows={8} defaultValue={values.plannerPrompt} />
        </label>
      </section>

      {state.error && <p className="error">บันทึกไม่ได้: {state.error}</p>}
      {state.saved && <p className="ok">บันทึกแล้ว</p>}
      <button className="primary" disabled={pending}>
        {pending ? "กำลังบันทึก…" : "บันทึก config"}
      </button>
    </form>
  )
}
