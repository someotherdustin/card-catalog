# Rotate TLS certificates

Use when the certificate expiry alert fires, at least 14 days before expiry.

1. Request a new certificate from the internal CA.
2. Update the `tls-cert` secret and restart the ingress.
