## 2026-07-09 - Focus Rings on Custom Inputs
**Learning:** Using `appearance: none` on webkit inputs like `input[type=range]` strips all default browser focus rings. The `:focus-visible` state must be completely recreated manually (e.g., via `box-shadow` on the thumb pseudo-element) to ensure keyboard navigation accessibility.
**Action:** Always verify keyboard accessibility manually for inputs utilizing custom `appearance: none` CSS, and explicitly add `:focus-visible` states mimicking standard focus rings.
