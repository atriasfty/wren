## 2024-07-02 - Ensure Custom Form UI Elements have Focus-Visible States
**Learning:** Custom styled interactive elements (like custom ranges, transparent backgrounds, or stylized buttons) often rely on custom styling which overriding native focus behavior, making them inaccessible for keyboard users if specific focus states are not explicitly added.
**Action:** Always include Tailwind `focus-visible` utility classes (e.g. `focus-visible:ring-2`) and ensure labels explicitly link to inputs using `for="..."` for custom styled form elements to maintain keyboard navigability.
