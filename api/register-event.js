if (fullName.length < 2) {
  return response.status(400).json({
    error: "Invalid name",
    code: "INVALID_NAME"
  });
}

if (!/^\S+@\S+\.\S+$/.test(email)) {
  return response.status(400).json({
    error: "Invalid email",
    code: "INVALID_EMAIL"
  });
}

/*
  Τηλέφωνο και επάγγελμα είναι προαιρετικά.
  Τα ελέγχουμε μόνο αν ο χρήστης έχει γράψει κάτι.
*/
if (phone && phone.length < 6) {
  return response.status(400).json({
    error: "Invalid phone",
    code: "INVALID_PHONE"
  });
}

if (profession && profession.length < 2) {
  return response.status(400).json({
    error: "Invalid profession",
    code: "INVALID_PROFESSION"
  });
}
