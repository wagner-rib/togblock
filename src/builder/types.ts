export interface LetterPayload {
  char: string;
  colour: string;
}

export interface CartItem {
  id: string;
  type: 'custom-name';
  name: string;
  theme: string;
  oneColour: string | null;
  brickSizePx: number;
  sizeLabel: string;
  letters: LetterPayload[];
  brickCount: number;
  price: number;
  currency: string;
  qty: number;
  createdAt: string;
}
