// A sliding glass door: equal panels on two rails, the middle ones slid
// open so people can walk through. The viewer draws this layout and the
// walker is stopped by the closed panels, so both agree on where the gap is.

// Panels taller than this get a fixed transom above them instead.
export const PANEL_HEIGHT = 2.7
// Rails sit this far either side of the wall's centerline.
export const RAIL_OFFSET = 0.03
const PANEL_MAX = 1.5

export interface Panel {
  // Where the panel sits when closed, along the opening from its start.
  from: number
  to: number
  rail: 0 | 1
  open: boolean
  // Where it is drawn: closed panels in place, open ones over a neighbour.
  at: number
}

export interface SliderLayout {
  panels: Panel[]
  // The clear walk-through, along the opening from its start.
  gap: { from: number; to: number }
  // Height of the moving panels; glass above that is fixed.
  panelTop: number
}

export function sliderLayout(width: number, height: number): SliderLayout {
  const count = Math.max(2, Math.ceil(width / PANEL_MAX))
  const panelWidth = width / count
  // Two panels: the first slides over the second. Three: the middle one over
  // the first. Four or more: the middle pair part, each over its neighbour.
  const half = Math.floor(count / 2)
  const open = count === 2 ? [0] : count === 3 ? [1] : [half - 1, half]
  const over = (i: number) => (count === 2 ? 1 : count === 3 ? 0 : i === half - 1 ? i - 1 : i + 1)
  const panels: Panel[] = []
  for (let i = 0; i < count; i++) {
    const isOpen = open.includes(i)
    panels.push({ from: i * panelWidth, to: (i + 1) * panelWidth, rail: (i % 2) as 0 | 1, open: isOpen, at: (isOpen ? over(i) : i) * panelWidth })
  }
  const gap = { from: open[0] * panelWidth, to: (open[open.length - 1] + 1) * panelWidth }
  return { panels, gap, panelTop: height > PANEL_HEIGHT + 0.3 ? PANEL_HEIGHT : height }
}
