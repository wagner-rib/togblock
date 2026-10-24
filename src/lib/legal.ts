// Business details shown on the Privacy Policy, Terms of Sale and Contact pages.
// legalName / postalAddress: the controller's identity under GDPR Art. 13 — fill in
// before relying on these pages (sole trader's name or company name + CRO number).
export const BUSINESS = {
  tradingName: 'TógBlocks',
  legalName: null as string | null,
  postalAddress: null as string | null,
  region: 'Co. Kildare, Ireland',
  email: 'togblocks@outlook.com',
  website: 'https://togblocks.com',
  lastUpdated: '24 October 2026',
};

/** "TógBlocks (Jane Doe), 1 Main St, …" when known, else trading name + region. */
export function controllerLine(): string {
  const who = BUSINESS.legalName ? `${BUSINESS.tradingName} (${BUSINESS.legalName})` : BUSINESS.tradingName;
  return `${who}, ${BUSINESS.postalAddress ?? BUSINESS.region}`;
}

/** Tracking IDs from the runtime env (validated); unset = no analytics/ads and no cookie banner. */
export function trackingIds(): { metaPixelId: string; ga4Id: string; enabled: boolean } {
  const rawPixel = process.env.META_PIXEL_ID ?? '';
  const rawGa4 = process.env.GA4_MEASUREMENT_ID ?? '';
  const metaPixelId = /^\d{5,20}$/.test(rawPixel) ? rawPixel : '';
  const ga4Id = /^G-[A-Z0-9]{4,15}$/.test(rawGa4) ? rawGa4 : '';
  return { metaPixelId, ga4Id, enabled: Boolean(metaPixelId || ga4Id) };
}
