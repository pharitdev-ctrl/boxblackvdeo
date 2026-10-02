import type { Transcript } from "../asr/types.ts"
import type { VideoInsight } from "../vision/describe.ts"
import type { SceneObjects } from "../vision/objects.ts"

/** One analysed video from the project's media bin. */
export interface FootageClip {
  id: string
  name: string
  durationUs: number
  transcript: Transcript | null
  insight: VideoInsight | null
  /** where the things in each of the insight's scenes are; absent or null before the objects pass has run */
  objects?: SceneObjects | null
  /** the video's own size in pixels, from the media bin; absent where it is not known */
  width?: number
  height?: number
}

export interface FootageIndex {
  clip(ref: string): FootageClip | undefined
  refOf(videoId: string): string | undefined
}

const sec = (us: number) => (us / 1_000_000).toFixed(1)

/**
 * Writes the footage out for the planner. Every clip, utterance and scene gets a short
 * reference (v1, u3, s2) so the planner picks material by reference instead of inventing
 * timestamps; times are shown only to help it judge pacing.
 */
export function describeFootage(clips: FootageClip[]): { text: string; index: FootageIndex } {
  const byRef = new Map(clips.map((clip, i) => [`v${i + 1}`, clip]))
  const refById = new Map(clips.map((clip, i) => [clip.id, `v${i + 1}`]))

  const sections = clips.map((clip, i) => {
    const lines = [`คลิป v${i + 1} · ${clip.name} · ยาว ${sec(clip.durationUs)} วินาที`]
    if (clip.insight?.summary) lines.push(`ภาพรวม: ${clip.insight.summary}`)

    const utterances = clip.transcript?.utterances ?? []
    if (utterances.length === 0) lines.push("คำพูด: ไม่มี")
    else lines.push("คำพูด:", ...utterances.map((u, n) => `u${n + 1} [${sec(u.startUs)}–${sec(u.endUs)}] ${u.text}`))

    if (!clip.insight) {
      lines.push("ฉาก: ยังไม่ได้วิเคราะห์ภาพ")
    } else {
      lines.push(
        "ฉาก:",
        ...clip.insight.scenes.map((scene, n) => {
          const issues = scene.issues.length ? ` · ปัญหา: ${scene.issues.join(", ")}` : ""
          return `s${n + 1} [${sec(scene.startUs)}–${sec(scene.endUs)}] ${scene.kind} · ${scene.description}${issues}`
        }),
      )
      // pauses are already visible between utterance times; only picture problems are worth listing
      const { blurry, black, frozen } = clip.insight.signals
      const measured = [
        ...blurry.map((r) => `ภาพเบลอ ${sec(r.startUs)}–${sec(r.endUs)}`),
        ...black.map((r) => `ภาพดำ ${sec(r.startUs)}–${sec(r.endUs)}`),
        ...frozen.map((r) => `ภาพนิ่งค้าง ${sec(r.startUs)}–${sec(r.endUs)}`),
      ]
      if (measured.length) lines.push(`ปัญหาที่วัดได้: ${measured.join(", ")}`)

      if (clip.insight.retakes.length) {
        const verdict = { A: "ควรใช้เทคก่อน", B: "ควรใช้เทคหลัง", same: "สองเทคพอๆ กัน" }
        lines.push(
          "เทคซ้ำ (พูดซ้ำ เทียบภาพของแต่ละเทคแล้ว):",
          ...clip.insight.retakes.map(({ takes: [first, second], notes, better, reason }) => {
            const takes = `เทคก่อน [${sec(first.startUs)}–${sec(first.endUs)}] ${first.text} · เทคหลัง [${sec(second.startUs)}–${sec(second.endUs)}] ${second.text}`
            return `- ${takes} · ${verdict[better]}: ${reason} (เทคก่อน: ${notes[0]} · เทคหลัง: ${notes[1]})`
          }),
        )
      }
    }
    return lines.join("\n")
  })

  return {
    text: sections.join("\n\n"),
    index: { clip: (ref) => byRef.get(ref), refOf: (videoId) => refById.get(videoId) },
  }
}
