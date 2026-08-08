Calendar notification behavior patch

Changes:
- No immediate FCM notification when a teacher calendar item is created.
- No immediate FCM notification when a teacher calendar item is edited.
- No FCM notification when a teacher calendar item is deleted.
- Scheduled reminder pushes (30 min / 1 hr / etc.) remain active.
- Shared "All teachers" events still use the server reminder scheduler for registered teachers.

Apply over the existing server folder, then redeploy/restart the server.
