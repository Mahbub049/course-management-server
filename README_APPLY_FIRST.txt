Marks Portal - FCM shared/web calendar notification fix (SERVER)

Apply:
1. Extract this ZIP directly into the existing server folder.
2. Choose Replace files in destination.
3. No new npm dependency is required by this patch.
4. Add these Render environment variables from a Firebase service account for
   the SAME Firebase project as the Android app:
      FIREBASE_PROJECT_ID
      FIREBASE_CLIENT_EMAIL
      FIREBASE_PRIVATE_KEY
5. Redeploy/restart the server.

Expected server log after configuration:
  Faculty calendar FCM reminder scheduler started.

Behavior:
- Personal teacher item -> creator's registered phone(s).
- All teachers item -> every registered teacher phone.
- Created from web or Android -> immediate server push.
- Update/delete -> immediate server push.
- Future teacher-calendar reminders -> server FCM at each teacher's selected
  reminder offsets, even when the React app is not kept open in background.
