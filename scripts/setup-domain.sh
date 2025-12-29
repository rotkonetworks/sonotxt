#!/bin/bash
# SonoTxt Domain Setup Script for Porkbun
#
# Usage:
#   export PORKBUN_API_KEY="pk1_..."
#   export PORKBUN_SECRET_KEY="sk1_..."
#   ./setup-domain.sh
#
# This script will:
#   1. Check if sonotxt.com is available
#   2. Register the domain if available
#   3. Set up DNS records for api, cdn, app subdomains

set -e

DOMAIN="sonotxt.com"
API_URL="https://porkbun.com/api/json/v3"

# Your server IP - update this
SERVER_IP="${SERVER_IP:-160.22.181.252}"

if [ -z "$PORKBUN_API_KEY" ] || [ -z "$PORKBUN_SECRET_KEY" ]; then
    echo "Error: Set PORKBUN_API_KEY and PORKBUN_SECRET_KEY environment variables"
    echo ""
    echo "  export PORKBUN_API_KEY='pk1_...'"
    echo "  export PORKBUN_SECRET_KEY='sk1_...'"
    exit 1
fi

auth_body() {
    echo "{\"apikey\":\"$PORKBUN_API_KEY\",\"secretapikey\":\"$PORKBUN_SECRET_KEY\"$1}"
}

api_call() {
    local endpoint="$1"
    local data="$2"
    curl -s -X POST "$API_URL/$endpoint" \
        -H "Content-Type: application/json" \
        -d "$data"
}

echo "=== SonoTxt Domain Setup ==="
echo ""

# Check pricing
echo "Checking domain pricing..."
pricing=$(api_call "pricing/get" "$(auth_body)")
com_price=$(echo "$pricing" | grep -o '"com":{[^}]*}' | grep -o '"registration":"[^"]*"' | cut -d'"' -f4)
echo "  .com registration: \$$com_price/year"
echo ""

# Check availability
echo "Checking if $DOMAIN is available..."
check=$(api_call "domain/check" "$(auth_body ",\"domain\":\"$DOMAIN\"")")
available=$(echo "$check" | grep -o '"avail":"[^"]*"' | cut -d'"' -f4)

if [ "$available" = "yes" ]; then
    echo "  ✓ $DOMAIN is available!"
    echo ""
    read -p "Register $DOMAIN for \$$com_price/year? (y/n) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Registering $DOMAIN..."
        register=$(api_call "domain/register" "$(auth_body ",\"domain\":\"$DOMAIN\",\"years\":1")")

        if echo "$register" | grep -q '"status":"SUCCESS"'; then
            echo "  ✓ Domain registered successfully!"
        else
            echo "  ✗ Registration failed:"
            echo "$register" | jq . 2>/dev/null || echo "$register"
            exit 1
        fi
    else
        echo "Skipping registration."
    fi
else
    echo "  Domain is not available or already registered"
    echo "  Response: $check"
fi

echo ""
echo "Setting up DNS records for $DOMAIN..."
echo "  Server IP: $SERVER_IP"
echo ""

# Function to create DNS record
create_record() {
    local name="$1"
    local type="$2"
    local content="$3"
    local ttl="${4:-600}"

    echo -n "  Creating $type record: $name.$DOMAIN -> $content ... "

    result=$(api_call "dns/create/$DOMAIN" "$(auth_body ",\"name\":\"$name\",\"type\":\"$type\",\"content\":\"$content\",\"ttl\":\"$ttl\"")")

    if echo "$result" | grep -q '"status":"SUCCESS"'; then
        echo "✓"
    else
        echo "✗"
        echo "    $result"
    fi
}

# Root domain
create_record "" "A" "$SERVER_IP"

# www redirect
create_record "www" "CNAME" "$DOMAIN"

# API subdomain
create_record "api" "A" "$SERVER_IP"

# CDN subdomain (same server for now, can point to R2/S3 later)
create_record "cdn" "A" "$SERVER_IP"

# App/Dashboard subdomain
create_record "app" "A" "$SERVER_IP"

echo ""
echo "=== DNS Records Summary ==="
echo ""
echo "  sonotxt.com        -> $SERVER_IP (landing page)"
echo "  www.sonotxt.com    -> sonotxt.com (redirect)"
echo "  api.sonotxt.com    -> $SERVER_IP (REST API)"
echo "  cdn.sonotxt.com    -> $SERVER_IP (embed.js + audio)"
echo "  app.sonotxt.com    -> $SERVER_IP (dashboard)"
echo ""
echo "DNS propagation may take a few minutes."
echo ""
echo "Next steps:"
echo "  1. Set up nginx/caddy to route subdomains"
echo "  2. Get SSL certificates (use certbot or Caddy auto-HTTPS)"
echo "  3. Update embed.js and extension to use production URLs"
