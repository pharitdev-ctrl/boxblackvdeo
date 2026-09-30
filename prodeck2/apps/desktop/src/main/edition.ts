/**
 * Whether this build asks for a license. Off for now: the app is handed out without one, and the
 * license code stays in place, untouched, for the version that turns it back on — flip this to
 * true and put the activation steps back in docs/customer-install.md.
 *
 * Off means: no activation screen and no License tab, nothing sent to a license server, the paid
 * methods not gated, and the prompts, cut presets and tested CapCut versions the server would have
 * sent taken from the app's own defaults. A license.json already on a machine is left alone.
 */
export const LICENSING = false
