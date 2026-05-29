#!/bin/bash
# Run once on a fresh EC2 instance (Ubuntu 22.04 LTS recommended)
# Usage: bash setup-ec2.sh YOUR_DOMAIN.com

set -e
DOMAIN=${1:?"Usage: $0 <domain> e.g. kyc.yourdomain.com"}

echo "==> Setting up KYC Service on EC2 for domain: $DOMAIN"

# 1. System updates
apt-get update -y && apt-get upgrade -y

# 2. Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# 3. Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# 4. Install git
apt-get install -y git curl

# 5. Clone repo
mkdir -p /opt/kyc-service
cd /opt/kyc-service
git clone https://github.com/DaxlinksG/kyc-service.git .

# 6. Create .env file
cat > /opt/kyc-service/.env << ENVEOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
JWT_SECRET=$(openssl rand -hex 32)
MASTER_API_KEY=kyc_master_$(openssl rand -hex 16)
API_KEY_PREFIX=kyc_live_
STORAGE_PATH=/data/storage
DB_PATH=/data/db/kyc.db
SESSION_TTL_HOURS=24
SESSION_TOKEN_TTL_HOURS=2
FACE_MATCH_THRESHOLD=0.5
RISK_APPROVE_THRESHOLD=0.80
RISK_MANUAL_THRESHOLD=0.55
ADDRESS_DOC_MAX_AGE_DAYS=90
CORS_ORIGINS=https://${DOMAIN}
ENVEOF

chmod 600 /opt/kyc-service/.env

# 7. Set your domain in nginx config
sed -i "s/YOUR_DOMAIN.com/${DOMAIN}/g" /opt/kyc-service/nginx/nginx.conf

# 8. Start nginx on port 80 only first (for SSL cert)
docker compose -f /opt/kyc-service/docker-compose.yml up -d nginx certbot

# 9. Obtain SSL certificate
docker run --rm \
  -v kyc-service_certbot_www:/var/www/certbot \
  -v kyc-service_certbot_conf:/etc/letsencrypt \
  certbot/certbot certonly \
  --webroot --webroot-path /var/www/certbot \
  --non-interactive --agree-tos \
  --email admin@${DOMAIN} \
  -d ${DOMAIN}

# 10. Build and start everything
cd /opt/kyc-service
docker compose up -d --build

# Wait for API to be healthy
echo "Waiting for API to start..."
for i in $(seq 1 12); do
  curl -sf http://localhost:3000/health && break
  echo "  attempt $i/12..."
  sleep 5
done

# 11. Show master key
echo ""
echo "========================================"
echo "✅  KYC Service is live at https://${DOMAIN}"
echo ""
echo "Your MASTER_API_KEY (save this securely):"
grep MASTER_API_KEY /opt/kyc-service/.env
echo ""
echo "Admin dashboard: https://${DOMAIN}/admin"
echo "========================================"
