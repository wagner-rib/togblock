export interface LetterPayload {
  char: string;
  colour: string;
}

export type LetterSize = 'small' | 'standard' | 'statement';
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
}
