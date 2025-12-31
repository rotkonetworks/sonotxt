#!/bin/bash
# generate embed signature for a domain
# usage: ./gen-embed-sig.sh <domain>

set -e

if [ -z "$1" ]; then
    echo "usage: $0 <domain>"
    exit 1
fi

DOMAIN="$1"

# load secret from .env or env var
if [ -z "$EMBED_SECRET" ]; then
    if [ -f "$(dirname "$0")/../rust/.env" ]; then
        EMBED_SECRET=$(grep EMBED_SECRET "$(dirname "$0")/../rust/.env" | cut -d= -f2)
    fi
fi

if [ -z "$EMBED_SECRET" ]; then
    echo "error: EMBED_SECRET not set"
    exit 1
fi

SIG=$(echo -n "$DOMAIN" | openssl dgst -sha256 -hmac "$EMBED_SECRET" | awk '{print $2}')

echo "domain: $DOMAIN"
echo "sig: $SIG"
echo ""
echo "embed code:"
echo "<script src=\"https://app.sonotxt.com/embed.js\" data-sig=\"$SIG\"></script>"
