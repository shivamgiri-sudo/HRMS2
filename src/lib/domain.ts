// Local-only deployment: no external SaaS domain
export const PRODUCTION_DOMAIN = "";

export function isProductionDomain(): boolean {
  return false;
}
