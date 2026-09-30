import type { DesktopApi } from "../shared/api.ts"
import type { ClaudeCode } from "./claude-code.ts"

type ClaudeCodeApi = Pick<
  DesktopApi,
  "claudeCodeStatus" | "installClaudeCode" | "loginClaudeCode" | "openClaudeCodeLogin" | "submitClaudeCodeLoginCode" | "cancelClaudeCode"
>

/** Claude Code set up from the settings screen. Install and login settle when they finish; events carry the way there. */
export function createClaudeCodeApi({ claudeCode }: { claudeCode: ClaudeCode }): ClaudeCodeApi {
  return {
    claudeCodeStatus: () => claudeCode.status(),
    installClaudeCode: () => claudeCode.install(),
    loginClaudeCode: () => claudeCode.login(),
    openClaudeCodeLogin: () => claudeCode.openLoginPage(),
    async submitClaudeCodeLoginCode(code) {
      if (typeof code !== "string") throw new Error("the code must be text")
      await claudeCode.submitLoginCode(code)
    },
    cancelClaudeCode: () => claudeCode.cancel(),
  }
}
