## 2024-05-18 - Missing label associations and focus states in custom UI controls
**Learning:** Found that custom stylized controls (like the HTML range input threshold slider) in this app often lack explicit `<label for="...">` associations and keyboard focus indicators, making them difficult for screen reader and keyboard users to discover and operate.
**Action:** Always verify that custom controls and inputs have an associated `for` label (or `aria-label`) and explicit `focus-visible` styling when reviewing front-end templates in this app.
