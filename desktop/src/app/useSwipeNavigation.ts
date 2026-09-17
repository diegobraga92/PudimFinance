import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { adjacentTabRoute } from '@/app/navigation';

const MOBILE_BREAKPOINT = 768;
const EDGE_GUARD_PX = 24;
const MIN_SWIPE_PX = 56;
const MAX_SWIPE_DURATION_MS = 600;

export interface SwipeSample {
  startX: number;
  startY: number;
  x: number;
  y: number;
  durationMs: number;
  viewportWidth: number;
  /** Number of active touches at the time of the sample, when known. */
  touchCount?: number;
}

/** Resolve a horizontal phone swipe without depending on browser APIs. */
export function resolveSwipeGesture(sample: SwipeSample): 'next' | 'prev' | null {
  const { startX, startY, x, y, durationMs, viewportWidth, touchCount = 1 } = sample;
  if (
    ![startX, startY, x, y, durationMs, viewportWidth].every(Number.isFinite) ||
    viewportWidth >= MOBILE_BREAKPOINT ||
    touchCount !== 1 ||
    durationMs < 0 ||
    durationMs > MAX_SWIPE_DURATION_MS ||
    startX <= EDGE_GUARD_PX ||
    startX >= viewportWidth - EDGE_GUARD_PX
  ) {
    return null;
  }

  const deltaX = x - startX;
  const deltaY = y - startY;
  if (Math.abs(deltaX) < MIN_SWIPE_PX || Math.abs(deltaX) <= Math.abs(deltaY)) return null;
  return deltaX < 0 ? 'next' : 'prev';
}

function isFormControl(element: Element): boolean {
  return Boolean(
    element.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])'),
  );
}

function hasHorizontalOverflow(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return (
    (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
    element.scrollWidth > element.clientWidth + 1
  );
}

function startsInHorizontalScroller(target: Element, boundary: HTMLElement): boolean {
  let element: Element | null = target;
  while (element) {
    if (hasHorizontalOverflow(element)) return true;
    if (element === boundary) break;
    element = element.parentElement;
  }
  return false;
}

/** Add mobile tab swipes to the routed content area without intercepting scroll. */
export function useSwipeNavigation(mainRef: React.RefObject<HTMLElement | null>): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathnameRef = React.useRef(pathname);
  pathnameRef.current = pathname;

  React.useEffect(() => {
    const main = mainRef.current;
    if (!main) return undefined;

    let start: { x: number; y: number; time: number } | null = null;

    const clear = () => {
      start = null;
    };

    const handleTouchStart = (event: TouchEvent) => {
      clear();
      if (!window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches) return;
      if (
        adjacentTabRoute(pathnameRef.current, 'next') === null &&
        adjacentTabRoute(pathnameRef.current, 'prev') === null
      ) {
        return;
      }
      if (event.touches.length !== 1) return;

      const target = event.target instanceof Element ? event.target : null;
      if (
        !target ||
        target.closest('[data-swipe-ignore]') ||
        startsInHorizontalScroller(target, main) ||
        isFormControl(target) ||
        window.getSelection()?.type === 'Range'
      ) {
        return;
      }

      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, time: performance.now() };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (start && event.touches.length !== 1) clear();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!start || event.changedTouches.length !== 1) {
        clear();
        return;
      }

      const touch = event.changedTouches[0];
      const direction = resolveSwipeGesture({
        startX: start.x,
        startY: start.y,
        x: touch.clientX,
        y: touch.clientY,
        durationMs: performance.now() - start.time,
        viewportWidth: window.innerWidth,
        // `touchend.touches` is empty after the final finger is lifted. Any
        // multi-touch sequence was already cancelled by `touchmove` above.
        touchCount: 1,
      });
      clear();
      if (!direction) return;

      const route = adjacentTabRoute(pathnameRef.current, direction);
      if (route) navigate(route);
    };

    main.addEventListener('touchstart', handleTouchStart, { passive: true });
    main.addEventListener('touchmove', handleTouchMove, { passive: true });
    main.addEventListener('touchend', handleTouchEnd, { passive: true });
    main.addEventListener('touchcancel', clear, { passive: true });
    return () => {
      main.removeEventListener('touchstart', handleTouchStart);
      main.removeEventListener('touchmove', handleTouchMove);
      main.removeEventListener('touchend', handleTouchEnd);
      main.removeEventListener('touchcancel', clear);
    };
  }, [mainRef, navigate]);
}