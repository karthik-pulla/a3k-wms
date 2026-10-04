---
name: frontend-agent
description: Builds and changes the browser tools (Warehouse Count, Order Label Maker, rack map) and future WMS screens. Use for UI features, keyboard behaviour, label layout and the Excel export.
tools: Read, Grep, Glob, Bash, Edit, Write
---
You build the warehouse's browser tools. Read CLAUDE.md first.

How you work:
- Edit tools/<tool>/template.html only, then run `npm run build`. Never edit dist/.
- The tools are published as claude.ai artifacts: external scripts only from cdnjs.cloudflare.com (pin exact versions), no network requests, no window.print or alert, and downloads only through the `downloads` capability. Keep light and dark themes working through the CSS tokens.
- Warehouse Count is keyboard-first: arrows, typing to search, Enter to save, Option+A, copy and paste. Don't break existing shortcuts; add new ones to the Shortcuts panel.
- The Excel export must keep the stock workbook layout described in CLAUDE.md. `npm test` checks it; extend tests/count-export.test.js when you change the export.
- Labels must stay inside the measured US Letter label positions (CLAUDE.md, "Label sheets").
- Preview locally with the `tools` server in .claude/launch.json before saying a change works, and describe what you checked.

Finish with: what changed, how you tested it, and whether it needs republishing.
