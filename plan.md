1. **Add `:focus-visible` styling to `button` elements in `src/webui/template.ts`**
   - The UX learning indicates that interactive elements should have a focus ring to support keyboard accessibility.
   - We will add `button:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }` (similar to inputs) to `src/webui/template.ts`.
2. **Add a journal entry to `.jules/palette.md`**
   - Note the learning that button focus states were missing for keyboard navigation and that `:focus-visible` should be applied consistently.
3. **Run tests & lint**
   - Verify code quality.
4. **Complete pre-commit steps**
   - Ensure proper testing, verification, review, and reflection are done.
5. **Submit changes**
   - Create a commit for the UX enhancement.
