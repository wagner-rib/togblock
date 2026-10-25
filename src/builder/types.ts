export interface LetterPayload {
  char: string;
  colour: string;
}

export type LetterSize = 'standard' | 'statement';
export type SignShape  = 'rectangle' | 'arch' | 'rounded';

export interface CartItem {
  id: string;
  type: 'custom-name' | 'door-sign';
  name: string;
  theme: string;
  oneColour: string | null;
  brickSizePx: number;
  sizeLabel: string;
  size?: LetterSize;
  shape?: SignShape;
  letters: LetterPayload[];
  brickCount: number;
  price: number;
  currency: string;
  qty: number;
  createdAt: string;
  plateColour?: string;
  textColour?: string;
  addons?: { dots: boolean; giftBox: boolean };
  thumbnailId?: string; // 3D-FIX-08: 512px preview PNG uploaded at Add to basket
}
