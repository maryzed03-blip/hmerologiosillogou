# Payment declaration flow

Για πληρωμένη δράση, η συμμετοχή δημιουργεί μοναδικό payment token και reference.
Το confirmation email εμφανίζει οδηγίες πληρωμής και κουμπί «Έκανα την κατάθεση».
Το κουμπί ανοίγει ασφαλή σελίδα επιβεβαίωσης (GET χωρίς side effect) και μόνο το δεύτερο click (POST) δημιουργεί `paymentDeclarations`.
Το Central Hub διαβάζει τις δηλώσεις server-to-server με ADMIN_CODE και τις εμφανίζει στον Ταμία ως «Προς έλεγχο».
