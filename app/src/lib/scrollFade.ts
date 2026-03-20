import { onCleanup, onMount } from 'solid-js';

/**
 * Directive: conditionally applies `scroll-fade` class only when
 * the element's content overflows horizontally.
 *
 * Usage: <div use:scrollFade class="overflow-x-auto">...</div>
 */
export function scrollFade(el: HTMLElement) {
  const check = () => {
    if (el.scrollWidth > el.offsetWidth) {
      el.classList.add('scroll-fade');
    } else {
      el.classList.remove('scroll-fade');
    }
  };

  const ro = new ResizeObserver(check);

  onMount(() => {
    ro.observe(el);
    check();
  });

  onCleanup(() => ro.disconnect());
}
