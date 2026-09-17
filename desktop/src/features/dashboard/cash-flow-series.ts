import type { CashFlowPoint } from './CashFlowCard';

/** Add the running (cumulative) net across the selected cash-flow window. */
export function withRunningNet(points: CashFlowPoint[]): CashFlowPoint[] {
  let running = 0;

  return points.map((point) => {
    running += point.net;
    return { ...point, running };
  });
}