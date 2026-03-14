## 2024-03-11 - Dynamic ARIA State and Focus Management
**Learning:** In a vanilla JS component setup (like BlankDrive's Web UI), dynamically managing state-based ARIA attributes (`aria-busy` for loading states, `aria-current` for active list items) and explicitly handling focus shifts for modals are critical for maintaining accessibility without a reactive framework.
**Action:** Ensure that utility functions (like `busy()`) and DOM builders (like `renderEntries()`) intrinsically bind semantic ARIA attributes to visual state changes, and always shift focus into and out of modals explicitly.

## 2024-03-24 - Screen Reader Cohesion for Complex Elements
**Learning:** Dynamically constructed elements (like list buttons) containing multiple child text nodes and visual indicators often cause screen readers to announce disjointed strings.
**Action:** Always provide a consolidated, fluid `aria-label` string to elements grouping fragmented data to ensure a cohesive screen-reader experience.
