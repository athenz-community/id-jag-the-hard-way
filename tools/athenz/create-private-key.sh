#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <service_name>"
  exit 1
fi

service_name=$1
echo "Generating RSA key pair for: ${service_name}..."

# Generate 2048-bit RSA private key
openssl genrsa -out "${service_name}.old.key" 2048 >/dev/null 2>&1

# Extract public key
openssl rsa -in "${service_name}.old.key" -outform PEM -pubout -out "${service_name}.public.key" 2>/dev/null

# Convert private key to traditional format (PKCS#1)
openssl pkey -in "${service_name}.old.key" -out "${service_name}.key" -traditional

# Cleanup intermediate key
rm "${service_name}.old.key"

echo "Done! Keys generated: ${service_name}.key, ${service_name}.public.key"
