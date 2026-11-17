
## 2024-07-28 - Dynamic Content Stack Accessibility
**Learning:** For dynamic elements like "Live Activity Streams" or "Detection Stacks" where items are injected dynamically (e.g., via Web Workers or ongoing events), screen readers will silently ignore the new content unless instructed otherwise.
**Action:** Always add `aria-live="polite"` (or `"assertive"` if critical) to the container wrapping the dynamically injected stack to ensure screen reader users are notified when new items appear.
