# Έλεγχος ειδοποιήσεων email

Στο Vercel > Settings > Environment Variables πρέπει να υπάρχουν ακριβώς:

- `GMAIL_USER` = `euassociationsepsyg@gmail.com`
- `GMAIL_APP_PASSWORD` = ο 16ψήφιος κωδικός εφαρμογής Google
- `NOTIFY_TO` = `euassociationsepsyg@gmail.com`

Οι μεταβλητές πρέπει να είναι ενεργές για **Production** και μετά χρειάζεται νέο **Redeploy**.

Μετά τη δοκιμή, η εφαρμογή εμφανίζει:

- `EMAIL_SENT`: το email στάλθηκε.
- `EMAIL_CONFIG_MISSING`: λείπει ή έχει λάθος όνομα κάποια μεταβλητή Vercel.
- `EAUTH`: λάθος Gmail ή App Password.
- `ETIMEDOUT` / `ESOCKET`: αποτυχία σύνδεσης SMTP.
- `HTTP_404`: ο φάκελος `api` δεν βρίσκεται στη ρίζα του GitHub repository.

Στο Vercel μπορείς να δεις το αναλυτικό σφάλμα από **Logs**, αναζητώντας `EMAIL_SEND_FAILED`.
