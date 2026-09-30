import { useEffect, useState } from "react"
import type { LicenseState, RendererApi } from "../../../shared/api.ts"
import { formatDate } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { blockedMessage, errorMessage } from "../screens/ActivationScreen.tsx"
import { Button } from "../ui/Button.tsx"

/** Whose license this machine runs on, in four facts, with the two things that can be done about it. */
export function LicenseCard({ api }: { api: RendererApi }) {
  const [state, setState] = useState<LicenseState | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void api.licenseState().then((next) => alive && setState(next))
    const stop = api.onEvent((event) => {
      if (event.type === "license") setState(event.state)
    })
    return () => {
      alive = false
      stop()
    }
  }, [api])

  const act = async (action: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="card" aria-labelledby="license-title">
        <div className="card-head">
          <h2 id="license-title">{t("license.title")}</h2>
        </div>
        {state?.state === "active" ? (
          <>
            <dl className="facts">
              <div>
                <dt>{t("license.customer")}</dt>
                <dd>{state.license.customer}</dd>
              </div>
              <div>
                <dt>{t("license.planLabel")}</dt>
                <dd>{t(`license.plan.${state.license.plan}` as MessageKey)}</dd>
              </div>
              <div>
                <dt>{t("license.expires")}</dt>
                <dd>{formatDate(state.license.expiresAt * 1000)}</dd>
              </div>
              <div>
                <dt>{t("license.devices")}</dt>
                <dd>{t("license.devicesValue", { used: state.license.devicesUsed, max: state.license.maxDevices })}</dd>
              </div>
            </dl>
            {state.offline && <p className="card-body warn-text">{t("license.offlineNote", { date: formatDate(state.tokenExpiresAt * 1000) })}</p>}
            {confirming ? (
              <div className="backup-confirm">
                <p>{t("license.releaseConfirm")}</p>
                <div className="backup-confirm-actions">
                  <Button size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                    {t("license.releaseNo")}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const result = await api.deactivateLicense()
                        setConfirming(false)
                        if (result.ok) setState(await api.licenseState())
                        else setMessage(errorMessage(result.error))
                      })
                    }
                  >
                    {t("license.releaseYes")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="card-foot">
                <Button size="sm" disabled={busy} onClick={() => void act(async () => setState(await api.refreshLicense()))}>
                  {t("license.check")}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => setConfirming(true)}>
                  {t("license.release")}
                </Button>
              </div>
            )}
          </>
        ) : state?.state === "blocked" ? (
          <p className="card-body warn-text">{blockedMessage(state)}</p>
        ) : (
          state && <p className="card-body hint">{t("license.none")}</p>
        )}
      </section>
      {message && <p className="notice error">{message}</p>}
    </>
  )
}
