export interface Theme {
  label: string;
  swatch: string[];
  single?: boolean;
  palette?: string[];
  color?: (i: number) => string;
}

export const THEMES: Record<string, Theme> = {
  rainbow: {
    label: 'Rainbow',
    swatch: ['#E0473A', '#F58A3C', '#F2C200', '#169B62', '#2B6CB0', '#7E5BD0'],
    color: (i) => `hsl(${(i * 47) % 360} 68% 52%)`,
  },
  irish: {
    label: 'Irish',
    swatch: ['#169B62', '#F58A3C', '#0E6B43', '#7FB69A'],
    palette: ['#169B62', '#F58A3C', '#0E6B43', '#7FB69A'],
  },
  classic: {
    label: 'Classic',
    swatch: ['#D8412F', '#2B6CB0', '#F2C200', '#169B62'],
    palette: ['#D8412F', '#2B6CB0', '#F2C200', '#169B62'],
  },
  pastel: {
    label: 'Pastel',
    swatch: ['#F6A6B2', '#A8D8C9', '#FBD9A0', '#B7C7EE', '#D9BEE8'],
    palette: ['#F6A6B2', '#A8D8C9', '#FBD9A0', '#B7C7EE', '#D9BEE8'],
  },
  one: {
    label: 'One colour',
    swatch: ['#169B62'],
    single: true,
  },
};

export function themeColor(key: string, idx: number, oneColor: string): string {
  const t = THEMES[key];
  if (!t) return oneColor;
  if (t.single) return oneColor;
  if (t.color) return t.color(idx);
  if (t.palette) return t.palette[idx % t.palette.length];
  return oneColor;
}

export const PICKER = [
  '#169B62', '#0E6B43', '#7FB69A', '#F58A3C',
  '#E0473A', '#F2C200', '#2B6CB0', '#7E5BD0',
  '#F6A6B2', '#1D2B22', '#FBF8F0', '#8A5A2B',
];
