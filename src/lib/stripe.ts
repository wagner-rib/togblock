import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-05-27.dahlia',
    });
  }
  return _stripe;
}

export type ShippingCountry = 'IE' | 'GB' | 'EU' | 'US' | 'OTHER';

export function shippingCost(country: ShippingCountry, subtotalCents: number): number {
  if (country === 'IE' && subtotalCents >= 4000) return 0;
  if (country === 'IE') return 495;
  if (country === 'GB') return 495;
  if (country === 'EU') return 495;
  if (country === 'US') return 699;
  return 0; // OTHER → handled via email, no online checkout
}

export const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR',
  'HR','HU','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
]);

export function classifyCountry(iso2: string): ShippingCountry {
  if (iso2 === 'IE') return 'IE';
  if (iso2 === 'GB') return 'GB';
  if (EU_COUNTRIES.has(iso2)) return 'EU';
  if (iso2 === 'US') return 'US';
  return 'OTHER';
}
