import * as React from 'react';

export type ChartTooltipTrigger = 'hover' | 'click';

interface ChartInteractionState {
  activeTooltipIndex?: number | string | null;
  activeIndex?: number | string | null;
  activeCoordinate?: {
    x?: number;
    y?: number;
  } | null;
}

const MOBILE_CHART_QUERY = '(max-width: 767px), (pointer: coarse)';

/** Resolve the active Recharts 3 point from a chart-level click or hover event. */
export function chartPointAtIndex<T>(state: unknown, data: readonly T[]): T | undefined {
  if (!state || typeof state !== 'object') return undefined;

  const interaction = state as ChartInteractionState;
  const coordinate = interaction.activeCoordinate;
  if (
    !coordinate ||
    typeof coordinate.x !== 'number' ||
    !Number.isFinite(coordinate.x) ||
    typeof coordinate.y !== 'number' ||
    !Number.isFinite(coordinate.y)
  ) {
    return undefined;
  }

  const rawIndex = interaction.activeTooltipIndex ?? interaction.activeIndex;
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index >= data.length) return undefined;
  return data[index];
}

function matchesChartQuery(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(MOBILE_CHART_QUERY).matches
  );
}

export function chartTooltipTriggerFor(isTouchLayout: boolean): ChartTooltipTrigger {
  return isTouchLayout ? 'click' : 'hover';
}

/** Use click-triggered tooltips on touch/narrow layouts so one tap has a fresh index. */
export function useChartTooltipTrigger(): ChartTooltipTrigger {
  const [isTouchLayout, setIsTouchLayout] = React.useState(matchesChartQuery);

  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(MOBILE_CHART_QUERY);
    const update = () => setIsTouchLayout(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return chartTooltipTriggerFor(isTouchLayout);
}