/**
 * Verifies license tokens offline. Must pair with the license server's LICENSE_SIGNING_KEY;
 * replace it with the production key (node scripts/license-keys.ts) before shipping.
 */
/** Release builds refuse a development key (apps/desktop/scripts/release-check.ts). */
export const LICENSE_KEY_KIND: "development" | "production" = "development"

export const LICENSE_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA2XwAeYQVPSn7dZkownI/dBxXL6nTPM+NW+NRiwvqb4I=\n-----END PUBLIC KEY-----\n"
