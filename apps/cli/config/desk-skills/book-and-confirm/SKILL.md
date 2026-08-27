---
name: book-and-confirm
description: Use when a job should go on the calendar — checks availability, proposes slots, books only with approval, and confirms with the customer.
---

# Book and confirm

1. Check the calendar first: `calendar_free` for the window, `calendar_list` for context. Propose two or three open slots.
2. Every booking carries: customer name, phone/email, address, vehicle or job details, and duration. Ask for what is missing.
3. Create the event only after the owner approves — `calendar_create` with `confirm: true`; put the address in `location` and the job details in `description`; add the customer as an attendee only if the owner wants them invited.
4. Draft the confirmation to the customer (`gmail_draft`); send only with approval.
5. Reminders and follow-ups: offer a `schedule_create` reminder the day before and a follow-up two days after the visit.
