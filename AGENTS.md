<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Debugging and investigation rules

When diagnosing any bug or issue: read the **entire** relevant file, not just the lines around the symptom. If the issue could span multiple files, read all of them before drawing conclusions. Never declare a root cause after reading a partial slice of a file — bugs almost always require full context to diagnose correctly.
