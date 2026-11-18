#!/usr/bin/env bash
# One-time setup and re-deploy of the CRM on a server that already runs nginx + certbot.
# Run as root from the project copy on the server:  sudo bash deploy/server-setup.sh
# Safe to run again for a new release: it keeps .env.production and the database volume.
#
# What it changes on the server:
#   - installs docker.io, docker-compose-v2, docker-buildx from Ubuntu's own packages (if missing)
#   - creates .env.production with random secrets (only if it does not exist yet)
#   - builds and starts the CRM containers; the site listens on 127.0.0.1:8081 only
#   - adds ONE new nginx site for $DOMAIN (other sites are not touched), checks `nginx -t`
#     before reloading, and gets an HTTPS certificate for $DOMAIN with certbot --webroot
set -euo pipefail

DOMAIN="${DOMAIN:-srm.sdsuz-inc.com}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SITE="/etc/nginx/sites-available/$DOMAIN"
cd "$APP_DIR"

echo "==> Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose-v2 docker-buildx >/dev/null
  systemctl enable --now docker
fi
docker --version

echo "==> .env.production"
if [ ! -f .env.production ]; then
  umask 077
  cat > .env.production <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_USER=sds
POSTGRES_DB=sds_crm
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
COMPANY_TIMEZONE=America/Chicago
SITE_DOMAIN=$DOMAIN
WEB_PORT=8081
EOF
  echo "created with new random secrets"
else
  echo "kept existing file"
fi

echo "==> Containers"
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8081/api/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://127.0.0.1:8081/api/health && echo

echo "==> nginx site for $DOMAIN"
mkdir -p /var/www/html
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  cp deploy/nginx-srm.conf "$SITE"
  ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
  nginx -t
  systemctl reload nginx
  echo "==> HTTPS certificate (webroot, like the other sites on this server)"
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email --deploy-hook "systemctl reload nginx"
fi
cp deploy/nginx-srm-ssl.conf "$SITE"
ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t
systemctl reload nginx

echo "==> Done: https://$DOMAIN"
