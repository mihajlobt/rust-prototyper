/**
 * Converts an array of stroke points into an SVG path string.
 * Used by the Lasso component to create a Path2D for hit-testing.
 *
 * Based on the React Flow whiteboard example:
 * https://reactflow.dev/examples/whiteboard/lasso-selection
 */
export function getSvgPathFromStroke(points: [number, number][]): string {
  if (points.length < 2) return "";
  const [first, ...rest] = points;
  const d = [`M ${first[0]} ${first[1]}`];
  for (const [x, y] of rest) {
    d.push(`L ${x} ${y}`);
  }
  d.push("Z");
  return d.join(" ");
}
