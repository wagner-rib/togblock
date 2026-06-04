import type { CartItem } from './types';

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
}

export function removeFromCart(id: string): void {
  const cart = loadCart().filter((i) => i.id !== id);
  saveCart(cart);
}

export function cartCount(): number {
  return loadCart().reduce((s, i) => s + (i.qty || 1), 0);
}
