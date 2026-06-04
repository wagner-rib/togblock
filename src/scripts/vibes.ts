const VIBE_KEY = 'togblocks_vibe';

const VIBES = [
  {
    id: 'clover',
    label: 'Clover',
    emoji: '🍀',
    dots: ['#169B62', '#F58A3C', '#0E6B43'],
  },
  {
    id: 'candy',
    label: 'Candy Pop',
    emoji: '🍬',
    dots: ['#7C3AED', '#EC4899', '#A78BFA'],
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    emoji: '🎮',
    dots: ['#2563EB', '#FACC15', '#60A5FA'],
  },
  {
    id: 'sunset',
    label: 'Sunset',
    emoji: '🌅',
    dots: ['#EA580C', '#FBBF24', '#FCA5A5'],
  },
  {
    id: 'midnight',
    label: 'Midnight',
    emoji: '🌙',
    dots: ['#14B8A6', '#F472B6', '#5EEAD4'],
  },
];

function getVibe(): string {
  return localStorage.getItem(VIBE_KEY) || 'cobalt';
}

function applyVibe(id: string): void {
  const html = document.documentElement;
  if (id === 'cobalt') {
    html.removeAttribute('data-vibe');
  } else {
    html.setAttribute('data-vibe', id);
  }
  localStorage.setItem(VIBE_KEY, id);
  // Update active state in panel
  document.querySelectorAll<HTMLElement>('.vibe-option').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.vibe === id);
    btn.setAttribute('aria-pressed', String(btn.dataset.vibe === id));
  });
  // Update toggle icon
  const vibe = VIBES.find((v) => v.id === id);
  const toggle = document.querySelector<HTMLElement>('.vibe-toggle');
  if (toggle && vibe) toggle.textContent = vibe.emoji;
}

function buildSwitcher(): void {
  const dock = document.createElement('div');
  dock.className = 'vibe-dock';
  dock.setAttribute('aria-label', 'Theme switcher');

  const panel = document.createElement('div');
  panel.className = 'vibe-panel';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Choose a colour vibe');
  panel.hidden = true;

  VIBES.forEach((vibe) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vibe-option';
    btn.dataset.vibe = vibe.id;
    btn.setAttribute('aria-pressed', 'false');
    const dots = vibe.dots
      .map((c) => `<span style="background:${c}"></span>`)
      .join('');
    btn.innerHTML = `<span class="vo-dots">${dots}</span>${vibe.emoji} ${vibe.label}`;
    btn.addEventListener('click', () => {
      applyVibe(vibe.id);
    });
    panel.appendChild(btn);
  });

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'vibe-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'vibe-panel');
  toggle.setAttribute('aria-label', 'Switch colour theme');
  toggle.textContent = '🍀';

  panel.id = 'vibe-panel';

  toggle.addEventListener('click', () => {
    const open = !panel.hidden;
    panel.hidden = open;
    toggle.setAttribute('aria-expanded', String(!open));
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!dock.contains(e.target as Node)) {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  dock.appendChild(panel);
  dock.appendChild(toggle);
  document.body.appendChild(dock);

  // Apply saved vibe immediately
  applyVibe(getVibe());
}

// Inject vibe before first paint to avoid flash
function initVibeEarly(): void {
  const saved = localStorage.getItem(VIBE_KEY);
  if (saved && saved !== 'clover') {
    document.documentElement.setAttribute('data-vibe', saved);
  }
}

initVibeEarly();
document.addEventListener('DOMContentLoaded', buildSwitcher);
