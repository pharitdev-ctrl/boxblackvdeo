import { handleRefresh } from "../../../../lib/api.ts"
import { licenseRoute } from "../../../../lib/http.ts"

export const POST = licenseRoute(handleRefresh)
