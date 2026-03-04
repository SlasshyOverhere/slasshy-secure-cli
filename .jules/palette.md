## 2024-05-24 - Add focus visible styling to buttons
**Learning:** Interactive elements like buttons require explicit focus-visible styles to maintain accessibility for keyboard navigation, particularly when focus rings are manually overridden or default browser styles are insufficient. The app establishes a consistent focus pattern (`box-shadow: 0 0 0 3px var(--accent-soft);`) for inputs that was missing from buttons.
**Action:** Added a `button:focus-visible` CSS rule in `src/webui/template.ts` that applies the same focus ring style used by inputs, improving keyboard accessibility.
