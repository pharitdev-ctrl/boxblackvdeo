import { afterEach, expect, test } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import type { LicenseState, RendererApi } from "../../../shared/api.ts"
import { activeLicense, fakeApi } from "../../test/fake-api.ts"
import { formatDate } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { ActivationScreen } from "./ActivationScreen.tsx"

afterEach(cleanup)

function renderScreen(state: Exclude<LicenseState, { state: "active" }>, overrides: Partial<RendererApi> = {}) {
  const api = fakeApi(overrides)
  const activated: LicenseState[] = []
  render(<ActivationScreen api={api} state={state} onActivated={(next) => activated.push(next)} />)
  return { api, activated }
}

const keyField = () => screen.getByLabelText(t("activation.keyLabel"))
const submit = () => screen.getByRole("button", { name: t("activation.submit") })

test("asks for the license key and activates this machine with it", async () => {
  const { api, activated } = renderScreen({ state: "unlicensed" })
  expect(screen.getByRole("heading", { name: t("activation.title") })).toBeTruthy()
  expect(submit()).toHaveProperty("disabled", true)
  await userEvent.type(keyField(), "PD2-AAAAA-BBBBB-CCCCC-DDDDD")
  await userEvent.click(submit())
  await waitFor(() => expect(activated).toEqual([activeLicense()]))
  expect(api.calls).toContainEqual(["activateLicense", "PD2-AAAAA-BBBBB-CCCCC-DDDDD"])
})

test("each reason a key is refused is explained", async () => {
  for (const error of ["invalid-key", "revoked", "expired", "device-limit", "rate-limited", "offline", "server-error"] as const) {
    const { activated } = renderScreen({ state: "unlicensed" }, { activateLicense: async () => ({ ok: false, error }) })
    await userEvent.type(keyField(), "PD2-X")
    await userEvent.click(submit())
    const message = error === "server-error" ? "activation.error.server" : `activation.error.${error}`
    expect(await screen.findByText(t(message as MessageKey))).toBeTruthy()
    expect(activated).toEqual([])
    cleanup()
  }
})

test("a blocked license says why, and can be checked again once fixed", async () => {
  const license = activeLicense()
  const info = license.state === "active" ? license.license : null
  const { api, activated } = renderScreen({ state: "blocked", reason: "expired", license: info })
  expect(screen.getByText(t("activation.blocked.expired", { date: formatDate(info!.expiresAt * 1000) }))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("activation.checkAgain") }))
  await waitFor(() => expect(activated).toEqual([activeLicense()]))
  expect(api.calls).toContainEqual(["refreshLicense"])
})

test("checking again while still blocked keeps the screen and says so", async () => {
  const still: LicenseState = { state: "blocked", reason: "token-expired", license: null }
  const { activated } = renderScreen(still, { refreshLicense: async () => still })
  expect(screen.getByText(t("activation.blocked.token-expired"))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("activation.checkAgain") }))
  expect(await screen.findByText(t("activation.stillBlocked"))).toBeTruthy()
  expect(activated).toEqual([])
})

test("a released or copied license offers only the key, since checking again cannot help", () => {
  for (const reason of ["not-activated", "wrong-device"] as const) {
    renderScreen({ state: "blocked", reason, license: null })
    expect(screen.getByText(t(`activation.blocked.${reason}`))).toBeTruthy()
    expect(screen.queryByRole("button", { name: t("activation.checkAgain") })).toBeNull()
    expect(keyField()).toBeTruthy()
    cleanup()
  }
})
