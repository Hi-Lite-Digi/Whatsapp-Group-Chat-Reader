#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_URI:?IMAGE_URI is required}"
: "${SECRET_ARN:?SECRET_ARN is required}"
: "${LOG_GROUP_NAME:?LOG_GROUP_NAME is required}"
: "${ARTIFACT_BUCKET:?ARTIFACT_BUCKET is required}"
: "${KMS_KEY_ARN:?KMS_KEY_ARN is required}"
: "${DASHBOARD_DOMAIN:?DASHBOARD_DOMAIN is required}"

DEPLOY_REGION="${AWS_REGION:-ap-southeast-1}"
APP_DIR=/opt/mrrjestic-whatsapp-listener
DATA_DIR=/var/lib/mrrjestic

systemctl start mrrjestic-data.service
mountpoint -q "$DATA_DIR"
mkdir -p "$APP_DIR" /run/mrrjestic
chmod 700 /run/mrrjestic

cat > "$APP_DIR/release.env" <<RELEASE_ENV
IMAGE_URI=$IMAGE_URI
AWS_REGION=$DEPLOY_REGION
SECRET_ARN=$SECRET_ARN
LOG_GROUP_NAME=$LOG_GROUP_NAME
ARTIFACT_BUCKET=$ARTIFACT_BUCKET
KMS_KEY_ARN=$KMS_KEY_ARN
DASHBOARD_DOMAIN=$DASHBOARD_DOMAIN
RELEASE_ENV
chmod 600 "$APP_DIR/release.env"

cat > "$APP_DIR/runtime.env" <<RUNTIME_ENV
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
ALLOW_SEND_MESSAGES=false
CORS_ORIGINS=https://$DASHBOARD_DOMAIN
ENV_ONLY_API_KEYS=true
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4.1-mini
AUTH_FOLDER=/app/runtime/auth
MEDIA_FOLDER=/app/runtime/media
DB_PATH=/app/runtime/data/whatsapp_bot.db
BACKUP_DIR=/app/runtime/backups
BACKUP_RETENTION_DAYS=14
ORACLE_PRICING_URL=https://tyre-pricing.onrender.com
MRRJESTIC_DASHBOARD_URL=https://hilitedigisite-dashboard-integratio.vercel.app
MRRJESTIC_DASHBOARD_SYNC_INTERVAL_MS=30000
MRRJESTIC_DASHBOARD_SYNC_TIMEOUT_MS=10000
WHATSAPP_RECONNECT_BASE_DELAY_MS=5000
WHATSAPP_RECONNECT_MAX_DELAY_MS=300000
WHATSAPP_RECONNECT_WATCHDOG_MS=60000
RUNTIME_ENV
chmod 600 "$APP_DIR/runtime.env"

cat > /usr/local/sbin/mrrjestic-load-secrets <<'LOAD_SECRETS'
#!/usr/bin/env bash
set -euo pipefail
source /opt/mrrjestic-whatsapp-listener/release.env
mkdir -p /run/mrrjestic
umask 077
secret_json=$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$SECRET_ARN" \
  --query SecretString \
  --output text)
printf '%s' "$secret_json" | jq -r '
  ["OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "ORACLE_API_TOKEN", "MONITOR_TOKEN", "MRRJESTIC_DASHBOARD_INGEST_KEY"] as $allowed
  | to_entries[]
  | select(.key as $key | $allowed | index($key))
  | select(.value != null)
  | "\(.key)=\(.value)"
' > /run/mrrjestic/secrets.env
chmod 600 /run/mrrjestic/secrets.env
unset secret_json
LOAD_SECRETS
chmod 750 /usr/local/sbin/mrrjestic-load-secrets

cat > /usr/local/sbin/mrrjestic-container-start <<'START_CONTAINER'
#!/usr/bin/env bash
set -euo pipefail
source /opt/mrrjestic-whatsapp-listener/release.env
/usr/local/sbin/mrrjestic-load-secrets
registry_host=$(printf '%s' "$IMAGE_URI" | cut -d/ -f1)
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$registry_host" >/dev/null
docker pull "$IMAGE_URI" >/dev/null
docker rm -f mrrjestic-whatsapp-listener >/dev/null 2>&1 || true
docker run -d \
  --name mrrjestic-whatsapp-listener \
  --restart unless-stopped \
  --env-file /opt/mrrjestic-whatsapp-listener/runtime.env \
  --env-file /run/mrrjestic/secrets.env \
  --publish 3000:3000 \
  --volume /var/lib/mrrjestic:/app/runtime \
  --log-driver awslogs \
  --log-opt "awslogs-region=$AWS_REGION" \
  --log-opt "awslogs-group=$LOG_GROUP_NAME" \
  --log-opt awslogs-stream=listener \
  "$IMAGE_URI" >/dev/null
START_CONTAINER
chmod 750 /usr/local/sbin/mrrjestic-container-start

cat > /usr/local/sbin/mrrjestic-upload-backups <<'UPLOAD_BACKUPS'
#!/usr/bin/env bash
set -euo pipefail
source /opt/mrrjestic-whatsapp-listener/release.env
find /var/lib/mrrjestic/backups -mindepth 1 -maxdepth 1 -type d -mmin -30 -print0 \
  | while IFS= read -r -d '' backup_dir; do
      aws s3 cp "$backup_dir" \
        "s3://$ARTIFACT_BUCKET/whatsapp-listener/backups/$(basename "$backup_dir")/" \
        --recursive \
        --region "$AWS_REGION" \
        --sse aws:kms \
        --sse-kms-key-id "$KMS_KEY_ARN" \
        --only-show-errors
    done
find /var/lib/mrrjestic/backups -maxdepth 1 -type f -mmin -30 -print0 \
  | while IFS= read -r -d '' backup_file; do
      aws s3 cp "$backup_file" \
        "s3://$ARTIFACT_BUCKET/whatsapp-listener/backups/$(basename "$backup_file")" \
        --region "$AWS_REGION" \
        --sse aws:kms \
        --sse-kms-key-id "$KMS_KEY_ARN" \
        --only-show-errors
    done
UPLOAD_BACKUPS
chmod 750 /usr/local/sbin/mrrjestic-upload-backups

cat > /etc/systemd/system/mrrjestic-listener.service <<'LISTENER_UNIT'
[Unit]
Description=Dedicated Mrrjestic WhatsApp listener
Requires=docker.service mrrjestic-data.service
After=docker.service mrrjestic-data.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/mrrjestic-container-start
ExecStop=-/usr/bin/docker stop --time 25 mrrjestic-whatsapp-listener
TimeoutStartSec=600
TimeoutStopSec=45

[Install]
WantedBy=multi-user.target
LISTENER_UNIT

cat > /etc/systemd/system/mrrjestic-backup.service <<'BACKUP_UNIT'
[Unit]
Description=Integrity-checked Mrrjestic runtime backup
Requires=mrrjestic-listener.service
After=mrrjestic-listener.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec mrrjestic-whatsapp-listener npm run backup
ExecStartPost=/usr/local/sbin/mrrjestic-upload-backups
BACKUP_UNIT

cat > /etc/systemd/system/mrrjestic-backup.timer <<'BACKUP_TIMER'
[Unit]
Description=Daily Mrrjestic backup at 03:15 Singapore time

[Timer]
OnCalendar=*-*-* 19:15:00 UTC
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
BACKUP_TIMER

systemctl daemon-reload
systemctl enable mrrjestic-listener.service
# The service is Type=oneshot with RemainAfterExit. `enable --now` leaves an
# already-active deployment on its previous image, so every release must run
# ExecStop/ExecStart explicitly after release.env is replaced.
systemctl restart mrrjestic-listener.service
systemctl enable --now mrrjestic-backup.timer

for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/health/ready >/dev/null; then
    printf 'listener_ready=true\n'
    exit 0
  fi
  sleep 2
done

docker logs --tail 100 mrrjestic-whatsapp-listener >&2 || true
exit 1
