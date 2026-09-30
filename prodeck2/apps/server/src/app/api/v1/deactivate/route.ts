import { handleDeactivate } from "../../../../lib/api.ts"
import { licenseRoute } from "../../../../lib/http.ts"

export const POST = licenseRoute(handleDeactivate)
