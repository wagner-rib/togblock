/* Hero slideshow, touch-draggable slider + scroll-reveal animations */

export function initHeroSlideshow(): void {
  const slides = document.querySelectorAll<HTMLElement>('[data-hero-slides] .hero-slide');
  const dots   = document.querySelectorAll<HTMLElement>('[data-hero-dots] .hero-dot');
  if (!slides.length) return;

  let current = 0;
  let timer: ReturnType<typeof setInterval>;

  function goTo(idx: number): void {
    slides[current].classList.remove('is-active');
    dots[current]?.classList.remove('is-active');
    current = idx;
    slides[current].classList.add('is-active');
    dots[current]?.classList.add('is-active');
  }

  function next(): void { goTo((current + 1) % slides.length); }

  function start(): void { timer = setInterval(next, 4500); }
  function stop():  void { clearInterval(timer); }

  // Dot click — jump to slide + restart timer
  dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      stop();
      goTo(Number(dot.dataset.index));
      start();
    });
  });

  // Pause on hover / touch
  const hero = document.querySelector<HTMLElement>('.home-hero');
  hero?.addEventListener('mouseenter', stop);
  hero?.addEventListener('mouseleave', start);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  start();
}

export function initSliders(): void {
  document.querySelectorAll<HTMLElement>('[data-slider]').forEach(initDragSlider);
}

function initDragSlider(track: HTMLElement): void {
  let startX = 0;
  let startTranslate = 0;
  let isDragging = false;
  let currentTranslate = 0;

  const pause = () => track.classList.add('is-paused');
  const resume = () => track.classList.remove('is-paused');

  track.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startTranslate = currentTranslate;
    pause();
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    currentTranslate = startTranslate + dx;
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; resume(); }
  });

  // Touch
  track.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startTranslate = currentTranslate;
    pause();
  }, { passive: true });

  track.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - startX;
    currentTranslate = startTranslate + dx;
  }, { passive: true });

  track.addEventListener('touchend', () => resume());
}

export function initReveal(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const els = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (!els.length) return;

  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -48px 0px' }
  );

  els.forEach((el) => obs.observe(el));
}

document.addEventListener('DOMContentLoaded', () => {
  initHeroSlideshow();
  initSliders();
  initReveal();
});
