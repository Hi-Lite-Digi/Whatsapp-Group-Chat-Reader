# AWS EC2 Deployment

This deployment runs exactly one persistent WhatsApp listener. It keeps the linked-device credentials, SQLite database, downloaded media, and backups under `/opt/mrrjestic-whatsapp-listener/runtime`.

## 1. Server baseline

- Ubuntu 24.04 LTS EC2 instance
- `t3.small` or larger, with at least 20 GB encrypted gp3 EBS
- Elastic IP if a stable dashboard address is required
- Security group: allow SSH only from the administrator IP
- Do not expose port 3000 publicly. Use an SSH tunnel, private VPN, or an HTTPS reverse proxy.

Install Docker Engine and the Compose plugin from Docker's official Ubuntu repository, then confirm:

```bash
docker --version
docker compose version
sudo systemctl enable --now docker
```

## 2. Install the application

```bash
sudo mkdir -p /opt/mrrjestic-whatsapp-listener
sudo chown "$USER":"$USER" /opt/mrrjestic-whatsapp-listener
cd /opt/mrrjestic-whatsapp-listener
git clone YOUR_PRIVATE_REPOSITORY_URL .
mkdir -p runtime/auth runtime/data runtime/media runtime/backups
sudo chown -R 1000:1000 runtime
cp .env.example .env.production
chmod 600 .env.production
```

Set these production values in `.env.production`:

```env
HOST=0.0.0.0
PORT=3000
ALLOW_SEND_MESSAGES=false
OPENAI_API_KEY=replace_on_server
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4.1-mini
ORACLE_PRICING_URL=https://tyre-pricing.onrender.com
ORACLE_API_TOKEN=replace_on_server
WHATSAPP_RECONNECT_BASE_DELAY_MS=5000
WHATSAPP_RECONNECT_MAX_DELAY_MS=300000
WHATSAPP_RECONNECT_WATCHDOG_MS=60000
BACKUP_RETENTION_DAYS=14
```

Do not commit `.env.production`, `runtime/auth`, or `runtime/data`.

## 3. Migrate the existing linked session

Only one process may use a linked-device session. Before migration, stop the local Mac listener and leave it stopped:

```bash
# On the Mac, in the project directory
pkill -f 'node src/server/index.js'
```

Checkpoint SQLite and package the existing state:

```bash
sqlite3 data/whatsapp_bot.db 'PRAGMA wal_checkpoint(TRUNCATE);'
tar -czf mrrjestic-runtime.tgz auth_info data/whatsapp_bot.db downloads/media 2>/dev/null || \
  tar -czf mrrjestic-runtime.tgz auth_info data/whatsapp_bot.db
scp mrrjestic-runtime.tgz ubuntu@SERVER_IP:/tmp/
```

Only migrate credentials when the local `/health/ready` endpoint reports `ready`. If it reports WhatsApp status `401`, logged out, or connection replaced, the credentials are already invalid. In that case, leave `runtime/auth` empty on EC2 and pair the listener once from the AWS-hosted dashboard instead.

On EC2:

```bash
cd /opt/mrrjestic-whatsapp-listener
mkdir -p /tmp/mrrjestic-runtime
tar -xzf /tmp/mrrjestic-runtime.tgz -C /tmp/mrrjestic-runtime
cp -a /tmp/mrrjestic-runtime/auth_info/. runtime/auth/
cp /tmp/mrrjestic-runtime/data/whatsapp_bot.db runtime/data/whatsapp_bot.db
if [ -d /tmp/mrrjestic-runtime/downloads/media ]; then
  cp -a /tmp/mrrjestic-runtime/downloads/media/. runtime/media/
fi
sudo chown -R 1000:1000 runtime
rm -rf /tmp/mrrjestic-runtime /tmp/mrrjestic-runtime.tgz
```

The `auth` directory contains sensitive WhatsApp linked-device keys. Transfer it only over SSH and never place it in Git, email, or shared cloud storage.

## 4. Start and verify

```bash
docker compose build --pull
docker compose up -d
docker compose logs -f --tail=100 listener
```

Expected log messages:

```text
WhatsApp connected successfully as Hi Lite Digital
Synced 3 WhatsApp group chats
```

Verify the two health levels:

```bash
curl -fsS http://127.0.0.1:3000/health/live
curl -fsS http://127.0.0.1:3000/health/ready
docker compose ps
```

`live` confirms the process is running. `ready` confirms WhatsApp is connected. Oracle connectivity is visible in the dashboard and through `/api/oracle/status`.

Access the private dashboard from a workstation:

```bash
ssh -L 3000:127.0.0.1:3000 ubuntu@SERVER_IP
```

Then open `http://127.0.0.1:3000`. For shared access, put the service behind HTTPS and authentication rather than exposing port 3000 directly.

## 5. Start automatically after reboot

```bash
sudo cp deploy/aws/mrrjestic-listener.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mrrjestic-listener.service
sudo systemctl status mrrjestic-listener.service
```

Docker also uses `restart: unless-stopped`, providing a second restart layer for process crashes and Docker daemon restarts.

## 6. Daily backups

Run one backup manually:

```bash
docker compose exec -T listener npm run backup
```

Install a daily 03:15 backup as the deployment user:

```bash
(crontab -l 2>/dev/null; echo '15 3 * * * cd /opt/mrrjestic-whatsapp-listener && /usr/bin/docker compose exec -T listener npm run backup >> runtime/backups/backup.log 2>&1') | crontab -
```

Backups retain SQLite and a disaster-recovery copy of the linked-device credentials for 14 days by default. Copy the backup directory to an encrypted S3 bucket using a separate IAM role if off-instance recovery is required.

## 7. Operations

```bash
# Current service and health
docker compose ps
curl -fsS http://127.0.0.1:3000/health/ready

# Recent logs
docker compose logs --tail=200 listener

# Deploy a new version without deleting runtime state
git pull
docker compose build
docker compose up -d

# Clean restart, preserving the WhatsApp session
docker compose restart listener
```

For the dedicated Hi-Lite production stack, package a clean reviewed commit and
run the release helper with the printed release ID and archive path:

```bash
deploy/aws/package-source.sh
RELEASE_ID=<printed-commit> SOURCE_ARCHIVE=<printed-archive> \
  deploy/aws/cloudshell-deploy.sh
```

The helper reuses the existing CloudFormation stack for normal application
releases, builds a new immutable ECR image, backs up the runtime, and restarts
the container on the existing singleton. Set `UPDATE_INFRASTRUCTURE=true` only
for a separately reviewed infrastructure change; an infrastructure update may
replace the EC2 instance when the latest AMI parameter changes.

Never run `docker compose down -v`, delete `runtime/auth`, press **Logout**, or call `/api/whatsapp/reset` during routine maintenance. Those actions require pairing again.

## Reliability boundary

The deployment preserves credentials and automatically recovers from EC2 reboots, process crashes, internet interruptions, rate limits, and ordinary WhatsApp WebSocket disconnects. WhatsApp can still revoke a linked device, force re-pairing, or replace a session if a second listener starts with the same credentials. Baileys is an unofficial WhatsApp Web integration; group listening is not supported by the official WhatsApp Cloud API. Monitor `/health/ready` and alert when it remains non-200 for more than five minutes.
