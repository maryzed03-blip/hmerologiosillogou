# Διόρθωση FIREBASE_PRIVATE_KEY στο Vercel

Το `ERR_OSSL_UNSUPPORTED` σημαίνει ότι το ιδιωτικό κλειδί δεν έφτασε στην εφαρμογή ως έγκυρο PEM.

Στο Vercel ανοίξτε:

**Project → Settings → Environment Variables → FIREBASE_PRIVATE_KEY → Edit**

Στο Value επικολλήστε ολόκληρη την τιμή του `private_key` από το αρχείο JSON του Firebase. Πρέπει να περιλαμβάνει:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

Η νέα έκδοση δέχεται και πραγματικές αλλαγές γραμμής και τη μορφή με `\n`. Δέχεται επίσης κατά λάθος εξωτερικά εισαγωγικά ή ολόκληρο το JSON και εξάγει το κλειδί αυτόματα.

Μετά την αποθήκευση κάντε νέο **Redeploy**, επειδή οι αλλαγές στις μεταβλητές δεν εφαρμόζονται σε παλιό deployment.
