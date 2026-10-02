import mascotDone from "../assets/mascot-done.png"
import mascotOops from "../assets/mascot-oops.png"
import mascotThink from "../assets/mascot-think.png"
import mascotWork from "../assets/mascot-work.png"

/** What the mascot is doing: thinking while Claude plans, at work while a write runs, glad when it went well, sorry when it failed. */
export type MascotPose = "think" | "work" | "done" | "oops"

/** Each pose's picture, and how wide it is for its height, so the room it takes is known before it loads. */
const POSES: Record<MascotPose, { src: string; ratio: number }> = {
  think: { src: mascotThink, ratio: 176 / 256 },
  work: { src: mascotWork, ratio: 220 / 256 },
  done: { src: mascotDone, ratio: 188 / 256 },
  oops: { src: mascotOops, ratio: 181 / 256 },
}

/**
 * The mascot, small, beside a line that says what is going on. It says nothing of its own: the words
 * beside it say it all, so a screen reader passes it by.
 */
export function Mascot({ pose, size = 28 }: { pose: MascotPose; size?: number }) {
  const { src, ratio } = POSES[pose]
  return <img className={`mascot mascot-${pose}`} src={src} alt="" width={Math.round(size * ratio)} height={size} />
}
