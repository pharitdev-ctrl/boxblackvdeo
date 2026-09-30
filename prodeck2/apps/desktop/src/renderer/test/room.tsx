import { useState } from "react"
import { act, render } from "@testing-library/react"
import type { ProjectDetail, RendererApi, StoredOutline } from "../../shared/api.ts"
import { ClipRoom } from "../src/room/ClipRoom.tsx"
import { PostScreen } from "../src/screens/PostScreen.tsx"
import { ToolbarSlot } from "../src/shell/AppShell.tsx"
import { detail, fakeApi, storedOutline, type FakeApi } from "./fake-api.ts"

export interface RoomOptions {
  capcutRunning?: boolean | null
  claim?: (folder: string | null, api: FakeApi) => void
  project?: ProjectDetail
  stored?: StoredOutline
}

/**
 * The room with the post page, and the app's bar it draws its buttons into (the AI menu and the write
 * button) rendered beside it, as the app's frame does: the bar's box is published through `ToolbarSlot`.
 * `setCapcutRunning` changes what the room is told of CapCut, as the app's poll does, and `restore` bumps
 * the room's draft as the app does after a backup is put back from the bar's menu.
 */
export function renderRoom(overrides: Partial<RendererApi> = {}, options: RoomOptions = {}) {
  const api = fakeApi(overrides)
  const project = options.project ?? detail()
  const stored = options.stored ?? storedOutline({ confirmed: true })
  let outline = 0
  let tellCapcut!: (running: boolean | null) => void
  let putBack!: () => void
  function Host() {
    const [slot, setSlot] = useState<HTMLDivElement | null>(null)
    const [draft, setDraft] = useState(0)
    // null is an answer of its own (CapCut not looked for yet), so only a missing option means closed
    const [capcutRunning, setCapcutRunning] = useState(options.capcutRunning === undefined ? false : options.capcutRunning)
    tellCapcut = setCapcutRunning
    putBack = () => setDraft((n) => n + 1)
    return (
      <ToolbarSlot.Provider value={slot}>
        <div className="topbar" ref={setSlot} />
        <ClipRoom
          api={api}
          project={project}
          stored={stored}
          capcutRunning={capcutRunning}
          draftVersion={draft}
          claim={options.claim && ((folder) => options.claim!(folder, api))}
        >
          <PostScreen onEditOutline={() => (outline += 1)} />
        </ClipRoom>
      </ToolbarSlot.Provider>
    )
  }
  render(<Host />)
  return {
    api,
    outline: () => outline,
    setCapcutRunning: (running: boolean | null) => act(() => tellCapcut(running)),
    restore: () => act(() => putBack()),
  }
}
