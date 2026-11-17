## 2025-02-18 - Improve Empty State Contrast and Accessibility
**Learning:** The empty state placeholder on the dark background used `text-slate-800`, which resulted in very poor contrast. The confidence threshold input was also missing a label association for screen readers.
**Action:** Use higher contrast text colors like `text-slate-400` for placeholders on dark backgrounds, and always remember to link labels to their inputs using the `for` attribute.
