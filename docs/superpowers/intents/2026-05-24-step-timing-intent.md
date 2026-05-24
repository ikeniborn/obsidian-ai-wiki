# Intent: Step Timing Display (#34)

**Date:** 2026-05-24
**Status:** draft

## Objective
Fix incorrect time display for steps in the progress view. Currently the implementation shows wrong/zero times for many steps.

## Desired Outcomes
- Each step shows real elapsed time for that step
- Each operation shows real elapsed time for that operation

## Health Metrics
- Time display present and non-zero for every step that has a measurable duration

## Constraints
- None

## Autonomy Level
Implementation decisions (how to calculate and display time per step) are made without asking.

## Stop Rules
Escalate if the fix requires architectural changes to how steps/events are tracked.
