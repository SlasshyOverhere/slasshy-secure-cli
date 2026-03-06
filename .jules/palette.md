## 2024-05-24 - Missing button focus states for keyboard navigation
**Learning:** In this application's components, buttons were missing explicit `:focus-visible` styles which made keyboard navigation difficult to track visually, despite inputs having it.
**Action:** Added `button:focus-visible` with a 3px box-shadow utilizing the `--accent-soft` CSS variable to maintain keyboard accessibility, matching the application's established focus ring styles.
