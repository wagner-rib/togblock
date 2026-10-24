import type { CartItem } from './types';
import { track } from '../scripts/track';

const CART_KEY = 'togblocks_cart';

export function loadCart(): CartItem[] {
  try {
    return (JSON.parse(localStorage.getItem(CART_KEY) ?? 'null') as CartItem[]) || [];
  } catch {
    return [];
  }
}

export function saveCart(items: CartItem[]): void {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  document.dispatchEvent(new CustomEvent('cart:update'));
}

export function addToCart(item: CartItem): void {
  const cart = loadCart();
  cart.push(item);
  saveCart(cart);
  track('AddToCart', { value: item.price * (item.qty || 1), items: [trackItem(item)] });
}

export function trackItem(item: CartItem) {
  return {
    id:       item.type === 'door-sign' ? 'DOOR-SIGN' : 'BRICK-LETTERS',
    name:     item.type === 'door-sign' ? 'Door / Room Sign' : 'Brick Name Letters',
    price:    item.price,
    quantity: item.qty || 1,
  };
}

export function removeFromCart(id: string): void {
  const cart = loadCart().filter((i) => i.id !== id);
  saveCart(cart);
}

export function cartCount(): number {
  return loadCart().reduce((s, i) => s + (i.qty || 1), 0);
}
