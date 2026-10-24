// Thin wrapper over window.tbTrack (defined inline in Base.astro). Safe to call before
// consent or with tracking unconfigured — Base queues or drops the event as appropriate.

export interface TrackItem { id: string; name: string; price: number; quantity: number }
export interface TrackData {
  value: number;
  currency?: string;
  id?: string;
  name?: string;
  items?: TrackItem[];
  transactionId?: string;
}
export type TrackEvent = 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase';

declare global {
  interface Window { tbTrack?: (event: TrackEvent, data: TrackData) => void }
}

export function track(event: TrackEvent, data: TrackData): void {
  try { window.tbTrack?.(event, data); } catch { /* analytics must never break the shop */ }
}
