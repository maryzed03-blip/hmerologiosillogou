# Ενεργοποίηση ειδοποιήσεων email

Στο Vercel άνοιξε το project και πήγαινε:

**Settings → Environment Variables**

Πρόσθεσε τις παρακάτω μεταβλητές και επίλεξε Production, Preview και Development:

1. `GMAIL_USER`
   - Τιμή: `euassociationsepsyg@gmail.com`
2. `GMAIL_APP_PASSWORD`
   - Τιμή: ο 16ψήφιος κωδικός εφαρμογής της Google
   - Μπορείς να τον επικολλήσεις με ή χωρίς τα κενά
3. `NOTIFY_TO`
   - Τιμή: `euassociationsepsyg@gmail.com`

Μετά κάνε νέο Deploy ή Redeploy. Οι μεταβλητές δεν εφαρμόζονται σε παλιότερο deployment.

Η εφαρμογή στέλνει email μετά από:
- νέα κράτηση,
- επεξεργασία κράτησης,
- ακύρωση κράτησης.

Ο κωδικός εφαρμογής δεν πρέπει να μπει στο GitHub ή στον κώδικα.
