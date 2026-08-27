---
name: describe-a-task
description: Use when the owner says "every morning…", "each Friday…", "remind me…", or "from now on when X do Y" — turns it into a durable routine (schedule) with a clear prompt.
---

# Describe a task once

1. Restate the routine in one sentence: what, when (with their time zone), and what "done" looks like.
2. Create it with `schedule_create`: use `every_seconds` for repeating routines (minimum 300), `at` for one-offs. The prompt you store must be self-contained — the future run does not see this conversation.
3. Read it back with `schedule_list` and confirm the next run time.
4. Routines only draft and report; anything that leaves the business still waits for approval in the run.
