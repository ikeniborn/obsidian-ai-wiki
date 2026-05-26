# Intent: Progress time display threshold

**Date:** 2026-05-26
**Status:** draft

## Objective

Progress lines in the Obsidian sidebar show time values like "0s" or "0.1s" — visual noise for fast operations. Show elapsed time only when it exceeds 1 second.

## Desired Outcomes

- Progress lines with elapsed time ≤ 1000ms render without any time indicator
- Progress lines with elapsed time > 1000ms render with time indicator as before
- No layout shift or placeholder where time was removed

## Health Metrics

- Operations with elapsed time > 1000ms continue to display time in the same format as currently
- No regressions in sidebar progress component rendering

## Strategic Context

- Interacts with: sidebar progress component (Obsidian plugin UI)
- Priority trade-off: speed (minimal change, surgical)

## Constraints

### Steering (behavioral guidance)

- Touch only the rendering logic — do not change how time is measured or stored
- Do not change the time format for visible cases

### Hard (architectural enforcement)

- Threshold is strictly `> 1000ms` (not `>= 1000`)
- No placeholder/empty span where time was — simply omit

## Autonomy Zones

- Full autonomy (reversible, low risk): locating and editing the render condition
- Proposal-first (needs approval): show diff/preview before committing

## Stop Rules

- Halt if: time measurement logic is coupled to display in a non-trivial way
- Done when: preview shown and approved by user, then committed
