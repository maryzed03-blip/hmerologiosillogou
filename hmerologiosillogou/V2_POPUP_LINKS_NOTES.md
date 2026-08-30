Changes made on the user's latest Firebase-connected project:

1. "Δήλωσε συμμετοχή" appears twice in each upcoming activity popup:
   near the top and again near the bottom.
2. The existing internal registration form remains unchanged and still
   posts to /api/register-event.
3. Every activity has a direct share URL using ?event=YYYY-MM-DD.
4. The popup includes "Αντιγραφή συνδέσμου".
5. Opening a popup updates the app/iframe URL to that event link.
6. Popup layout has been refined with framed sections.
7. Existing Firebase data is not modified by deploying this code.
