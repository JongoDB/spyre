#!/bin/bash
# =============================================================================
# Spyre Controller — Setup Script
# =============================================================================
#
# Run this on the Ubuntu Server 24.04 VM that will be your Spyre controller.
# It installs all dependencies, generates SSH keys, discovers your network,
# prompts for Proxmox details, and produces environment.yaml.
#
# Usage:
#   chmod +x setup.sh && ./setup.sh
#
# After completion:
#   - environment.yaml is generated at the project root
#   - Claude Code is installed (authenticate via the web UI later)
#   - All dependencies are installed
#   - systemd service is ready (enable after first build)
#
# See: docs/spyre-architecture.md for full design
#      docs/implementation-plan.md for build sequence
#      CLAUDE.md for coding conventions
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SPYRE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SPYRE_DIR}/environment.yaml"
LOG_FILE="${SPYRE_DIR}/setup.log"

log()  { echo -e "${GREEN}[✓]${NC} $1"; echo "[$(date -Is)] $1" >> "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; echo "[$(date -Is)] WARN: $1" >> "$LOG_FILE"; }
err()  { echo -e "${RED}[✗]${NC} $1"; echo "[$(date -Is)] ERROR: $1" >> "$LOG_FILE"; }
ask()  { echo -en "${CYAN}[?]${NC} $1"; }

echo "" > "$LOG_FILE"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         Spyre Controller — Initial Setup             ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# Phase 1: System Dependencies
# =============================================================================

echo -e "${BOLD}── Phase 1: System Dependencies ──${NC}"
echo ""

log "Updating package lists..."
sudo apt update -qq >> "$LOG_FILE" 2>&1

log "Installing system packages..."
sudo apt install -y -qq \
  curl git tmux jq sqlite3 openssh-client openssh-server \
  caddy expect python3 python3-pip net-tools \
  >> "$LOG_FILE" 2>&1

# Node.js 22
if command -v node &>/dev/null && [[ "$(node -v)" == v22* ]]; then
  log "Node.js 22 already installed: $(node -v)"
else
  log "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >> "$LOG_FILE" 2>&1
  sudo apt install -y -qq nodejs >> "$LOG_FILE" 2>&1
  log "Node.js installed: $(node -v)"
fi

# Claude Code
if command -v claude &>/dev/null; then
  log "Claude Code already installed: $(claude --version 2>/dev/null || echo 'version unknown')"
else
  log "Installing Claude Code..."
  sudo npm install -g @anthropic-ai/claude-code >> "$LOG_FILE" 2>&1
  log "Claude Code installed"
fi

echo ""

# =============================================================================
# Phase 2: Auto-Discovery
# =============================================================================

echo -e "${BOLD}── Phase 2: Auto-Discovery ──${NC}"
echo ""

# Detect controller IP
DETECTED_IP=""
DEFAULT_IFACE=$(ip route | grep default | awk '{print $5}' | head -1)
if [[ -n "$DEFAULT_IFACE" ]]; then
  DETECTED_IP=$(ip -4 addr show "$DEFAULT_IFACE" | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
fi

if [[ -n "$DETECTED_IP" ]]; then
  log "Detected controller IP: ${DETECTED_IP} (interface: ${DEFAULT_IFACE})"
else
  warn "Could not auto-detect IP address"
fi

# Detect hostname
DETECTED_HOSTNAME=$(hostname -f 2>/dev/null || hostname)
log "Detected hostname: ${DETECTED_HOSTNAME}"

# Detect subnet
DETECTED_SUBNET=""
if [[ -n "$DEFAULT_IFACE" ]]; then
  DETECTED_SUBNET=$(ip -4 addr show "$DEFAULT_IFACE" | grep -oP '\d+(\.\d+){3}/\d+' | head -1)
  # Convert to network address (rough — replaces last octet with 0)
  DETECTED_SUBNET=$(echo "$DETECTED_SUBNET" | sed 's/\.[0-9]*\//\.0\//')
fi

DETECTED_GATEWAY=$(ip route | grep default | awk '{print $3}' | head -1)

log "Detected subnet: ${DETECTED_SUBNET:-unknown}"
log "Detected gateway: ${DETECTED_GATEWAY:-unknown}"

echo ""

# =============================================================================
# Phase 3: Proxmox Details (Interactive)
# =============================================================================

echo -e "${BOLD}── Phase 3: Proxmox Configuration ──${NC}"
echo ""
echo "  Enter your Proxmox VE host details. These are used by Spyre to"
echo "  communicate with the Proxmox API for VM/LXC management."
echo ""

# Proxmox host IP
ask "Proxmox host IP address: "
read -r PVE_HOST
if [[ -z "$PVE_HOST" ]]; then
  err "Proxmox host IP is required."
  exit 1
fi

# Proxmox node name
ask "Proxmox node name [default: pve]: "
read -r PVE_NODE
PVE_NODE="${PVE_NODE:-pve}"

# Proxmox API port
ask "Proxmox API port [default: 8006]: "
read -r PVE_PORT
PVE_PORT="${PVE_PORT:-8006}"

# API Token
echo ""
echo "  Spyre needs a Proxmox API token. If you haven't created one yet:"
echo ""
echo "    On your Proxmox host, run:"
echo "      pveum user add spyre@pam --password <temp-password>"
echo "      pveum aclmod / -user spyre@pam -role PVEVMAdmin"
echo "      pveum user token add spyre@pam automation --privsep 0"
echo ""
echo "    The command will output a token value. Paste the full token ID"
echo "    and secret below."
echo ""

ask "API Token ID (e.g., spyre@pam!automation): "
read -r PVE_TOKEN_ID
ask "API Token Secret (e.g., xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx): "
read -rs PVE_TOKEN_SECRET
echo ""

# Verify Proxmox connectivity
echo ""
log "Testing Proxmox API connectivity..."
PVE_AUTH_HEADER="PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}"
HTTP_CODE=$(curl -s -o /tmp/pve_test.json -w "%{http_code}" \
  -k -H "Authorization: ${PVE_AUTH_HEADER}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/version" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
  PVE_VERSION=$(jq -r '.data.version // "unknown"' /tmp/pve_test.json 2>/dev/null)
  log "Proxmox API connected successfully (PVE ${PVE_VERSION})"
else
  warn "Could not connect to Proxmox API (HTTP ${HTTP_CODE})"
  warn "Continuing setup — you can fix the connection details in environment.yaml later"
fi

# Discover storage pools
echo ""
log "Querying Proxmox storage pools..."
STORAGE_JSON="[]"
STORAGE_RESPONSE=$(curl -s -k -H "Authorization: ${PVE_AUTH_HEADER}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/${PVE_NODE}/storage" 2>/dev/null || echo "")

if [[ -n "$STORAGE_RESPONSE" ]]; then
  STORAGE_JSON=$(echo "$STORAGE_RESPONSE" | jq '[.data[]? | {name: .storage, type: .type, content: .content, active: .active}]' 2>/dev/null || echo "[]")
  STORAGE_COUNT=$(echo "$STORAGE_JSON" | jq 'length' 2>/dev/null || echo "0")
  log "Found ${STORAGE_COUNT} storage pool(s)"
  echo "$STORAGE_JSON" | jq -r '.[] | "      \(.name) (\(.type)) — content: \(.content)"' 2>/dev/null
else
  warn "Could not query storage pools — will need manual entry in environment.yaml"
fi

# Discover bridges
log "Querying Proxmox network bridges..."
BRIDGES_JSON="[]"
BRIDGES_RESPONSE=$(curl -s -k -H "Authorization: ${PVE_AUTH_HEADER}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/${PVE_NODE}/network" 2>/dev/null || echo "")

if [[ -n "$BRIDGES_RESPONSE" ]]; then
  BRIDGES_JSON=$(echo "$BRIDGES_RESPONSE" | jq '[.data[]? | select(.type == "bridge") | {name: .iface, address: .address, cidr: .cidr}]' 2>/dev/null || echo "[]")
  BRIDGES_COUNT=$(echo "$BRIDGES_JSON" | jq 'length' 2>/dev/null || echo "0")
  log "Found ${BRIDGES_COUNT} bridge(s)"
  echo "$BRIDGES_JSON" | jq -r '.[] | "      \(.name) — \(.address // "no IP") \(.cidr // "")"' 2>/dev/null
else
  warn "Could not query bridges — will need manual entry in environment.yaml"
fi

# Discover available templates
log "Querying available container templates..."
TEMPLATES_JSON="[]"
# Check common storage locations for templates
for STOR in "local" $(echo "$STORAGE_JSON" | jq -r '.[].name' 2>/dev/null); do
  TPL_RESPONSE=$(curl -s -k -H "Authorization: ${PVE_AUTH_HEADER}" \
    "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/${PVE_NODE}/storage/${STOR}/content?content=vztmpl" 2>/dev/null || echo "")
  if [[ -n "$TPL_RESPONSE" ]]; then
    STORE_TEMPLATES=$(echo "$TPL_RESPONSE" | jq "[.data[]? | {volid: .volid, size: .size}]" 2>/dev/null || echo "[]")
    TEMPLATES_JSON=$(echo "$TEMPLATES_JSON $STORE_TEMPLATES" | jq -s 'add | unique_by(.volid)' 2>/dev/null || echo "[]")
  fi
done
TEMPLATE_COUNT=$(echo "$TEMPLATES_JSON" | jq 'length' 2>/dev/null || echo "0")
log "Found ${TEMPLATE_COUNT} container template(s)"
if [[ "$TEMPLATE_COUNT" -gt 0 ]]; then
  echo "$TEMPLATES_JSON" | jq -r '.[].volid' 2>/dev/null | head -10 | while read -r tpl; do
    echo "      ${tpl}"
  done
  if [[ "$TEMPLATE_COUNT" -gt 10 ]]; then
    echo "      ... and $((TEMPLATE_COUNT - 10)) more"
  fi
fi

echo ""

# =============================================================================
# Phase 4: Spyre-Specific Configuration
# =============================================================================

echo -e "${BOLD}── Phase 4: Spyre Configuration ──${NC}"
echo ""

# Controller accessible URL
ask "URL users will access Spyre at [default: https://${DETECTED_HOSTNAME}]: "
read -r SPYRE_URL
SPYRE_URL="${SPYRE_URL:-https://${DETECTED_HOSTNAME}}"
# Strip trailing slash
SPYRE_URL="${SPYRE_URL%/}"

# Default bridge for new environments
DEFAULT_BRIDGE=$(echo "$BRIDGES_JSON" | jq -r '.[0].name // "vmbr0"' 2>/dev/null)
ask "Default network bridge for new environments [default: ${DEFAULT_BRIDGE}]: "
read -r ENV_BRIDGE
ENV_BRIDGE="${ENV_BRIDGE:-$DEFAULT_BRIDGE}"

# Default storage for new environments
DEFAULT_STORAGE=$(echo "$STORAGE_JSON" | jq -r '[.[] | select(.content | contains("rootdir"))][0].name // "local-lvm"' 2>/dev/null)
ask "Default storage for new environment disks [default: ${DEFAULT_STORAGE}]: "
read -r ENV_STORAGE
ENV_STORAGE="${ENV_STORAGE:-$DEFAULT_STORAGE}"

# DNS
ask "DNS server for new environments [default: ${DETECTED_GATEWAY:-8.8.8.8}]: "
read -r ENV_DNS
ENV_DNS="${ENV_DNS:-${DETECTED_GATEWAY:-8.8.8.8}}"

echo ""

# =============================================================================
# Phase 5: SSH Key Generation
# =============================================================================

echo -e "${BOLD}── Phase 5: SSH Keys ──${NC}"
echo ""

SSH_KEY_PATH="$HOME/.ssh/spyre_ed25519"
if [[ -f "$SSH_KEY_PATH" ]]; then
  log "SSH key already exists: ${SSH_KEY_PATH}"
else
  log "Generating SSH key pair for Spyre → Worker connections..."
  mkdir -p "$HOME/.ssh"
  ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "spyre-controller@${DETECTED_HOSTNAME}" >> "$LOG_FILE" 2>&1
  log "SSH key generated: ${SSH_KEY_PATH}"
fi

SSH_PUBLIC_KEY=$(cat "${SSH_KEY_PATH}.pub")
log "Public key (auto-injected into new environments):"
echo "      ${SSH_PUBLIC_KEY}"

# Configure SSH client for Spyre connections
if ! grep -q "spyre-worker" "$HOME/.ssh/config" 2>/dev/null; then
  log "Adding Spyre SSH config..."
  mkdir -p "$HOME/.ssh/sockets"
  cat >> "$HOME/.ssh/config" << EOF

# --- Spyre managed connections ---
Host pve-host
    HostName ${PVE_HOST}
    User root
    IdentityFile ${SSH_KEY_PATH}
    StrictHostKeyChecking accept-new
    ConnectTimeout 10

Host spyre-worker-*
    IdentityFile ${SSH_KEY_PATH}
    StrictHostKeyChecking accept-new
    ServerAliveInterval 30
    ServerAliveCountMax 5
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
    ConnectTimeout 10
EOF
  chmod 600 "$HOME/.ssh/config"
else
  log "Spyre SSH config already present"
fi

echo ""

# =============================================================================
# Phase 5b: Copy SSH Key to Proxmox Host
# =============================================================================

echo -e "${BOLD}── Phase 5b: Proxmox Host SSH Access ──${NC}"
echo ""
echo "  Spyre needs SSH access to the Proxmox host for container management"
echo "  and community script deployment."
echo ""

ask "Copy SSH key to Proxmox host (root@${PVE_HOST})? [Y/n]: "
read -r COPY_KEY
COPY_KEY="${COPY_KEY:-Y}"

if [[ "$COPY_KEY" =~ ^[Yy] ]]; then
  ssh-copy-id -i "${SSH_KEY_PATH}.pub" -o StrictHostKeyChecking=accept-new \
    "root@${PVE_HOST}" 2>> "$LOG_FILE"
  if [ $? -eq 0 ]; then
    log "SSH key copied. Testing connection..."
    if ssh -i "${SSH_KEY_PATH}" -o ConnectTimeout=5 "root@${PVE_HOST}" "hostname" >> "$LOG_FILE" 2>&1; then
      log "SSH to Proxmox host verified."
    else
      warn "Key copied but connection test failed. Check firewall."
    fi
  else
    warn "Failed to copy SSH key. Do it manually later:"
    echo "      ssh-copy-id -i ${SSH_KEY_PATH}.pub root@${PVE_HOST}"
  fi
else
  warn "Skipped. Community scripts won't work without SSH access."
  echo "      To set up later: ssh-copy-id -i ${SSH_KEY_PATH}.pub root@${PVE_HOST}"
fi

echo ""

# =============================================================================
# Phase 6: Generate environment.yaml
# =============================================================================

echo -e "${BOLD}── Phase 6: Generating environment.yaml ──${NC}"
echo ""

cat > "$ENV_FILE" << ENVYAML
# =============================================================================
# Spyre Environment Configuration
# =============================================================================
#
# Auto-generated by setup.sh on $(date -Is)
# This file is read by Spyre at startup. All infrastructure-specific values
# live here — never hardcode them in application code.
#
# Referenced by:
#   - src/lib/server/env-config.ts (loaded as typed singleton)
#   - CLAUDE.md (coding conventions require using this file)
#   - docs/implementation-plan.md (phases reference these values)
#
# To regenerate: re-run setup.sh
# To edit: modify this file directly and restart Spyre
# =============================================================================

# --- Controller (this machine) ---
controller:
  hostname: "${DETECTED_HOSTNAME}"
  ip: "${DETECTED_IP}"
  url: "${SPYRE_URL}"
  ssh_key_path: "${SSH_KEY_PATH}"
  ssh_public_key: "${SSH_PUBLIC_KEY}"
  data_dir: "${SPYRE_DIR}/data"
  config_dir: "${SPYRE_DIR}/configs"
  db_path: "${SPYRE_DIR}/data/spyre.db"

# --- Proxmox VE Host ---
proxmox:
  host: "${PVE_HOST}"
  port: ${PVE_PORT}
  node_name: "${PVE_NODE}"
  token_id: "${PVE_TOKEN_ID}"
  # Token secret is stored separately for security — see /etc/spyre/env
  # The application reads SPYRE_PVE_TOKEN_SECRET from the environment.
  verify_ssl: false  # Set to true if you've configured a real CA for Proxmox

  # Auto-discovered from Proxmox API
  storage_pools:
$(echo "$STORAGE_JSON" | jq -r '.[] | "    - name: \"\(.name)\"\n      type: \"\(.type)\"\n      content: \"\(.content)\"\n      active: \(.active)"' 2>/dev/null || echo "    []")

  bridges:
$(echo "$BRIDGES_JSON" | jq -r '.[] | "    - name: \"\(.name)\"\n      address: \"\(.address // "none")\""' 2>/dev/null || echo "    []")

  available_templates:
$(echo "$TEMPLATES_JSON" | jq -r '.[] | "    - \"\(.volid)\""' 2>/dev/null || echo "    []")

# --- Default Settings for New Environments ---
defaults:
  bridge: "${ENV_BRIDGE}"
  storage: "${ENV_STORAGE}"
  dns: "${ENV_DNS}"
  gateway: "${DETECTED_GATEWAY:-}"
  subnet: "${DETECTED_SUBNET:-}"
  ssh_user: "root"  # Default SSH user for new LXCs

# --- Network ---
network:
  subnet: "${DETECTED_SUBNET:-}"
  gateway: "${DETECTED_GATEWAY:-}"
  dns: "${ENV_DNS}"

# --- Claude Code ---
claude:
  # Auth method: "oauth" (via browser relay) or "api_key" (via ANTHROPIC_API_KEY env var)
  auth_method: "oauth"
  # Health check interval in milliseconds
  health_check_interval: 60000
  # Task timeout in milliseconds (10 minutes)
  task_timeout: 600000
  # auth.json location (Claude Code default)
  auth_json_path: "${HOME}/.config/claude-code/auth.json"
ENVYAML

log "Generated: ${ENV_FILE}"

# =============================================================================
# Phase 7: Secure Token Storage
# =============================================================================

echo ""
echo -e "${BOLD}── Phase 7: Secure Token Storage ──${NC}"
echo ""

sudo mkdir -p /etc/spyre
cat | sudo tee /etc/spyre/env > /dev/null << EOF
# Spyre environment secrets — loaded by systemd EnvironmentFile
# Permissions: 600, owned by root. Spyre service reads at startup.
SPYRE_PVE_TOKEN_SECRET=${PVE_TOKEN_SECRET}
SPYRE_BASE_URL=${SPYRE_URL}
NODE_ENV=production
EOF
sudo chmod 600 /etc/spyre/env

log "Token stored securely in /etc/spyre/env (permissions: 600)"

# =============================================================================
# Phase 8: Directory Structure & Database
# =============================================================================

echo ""
echo -e "${BOLD}── Phase 8: Project Structure ──${NC}"
echo ""

mkdir -p "${SPYRE_DIR}"/{data,configs/bases,scripts/post-provision,docs}
mkdir -p "${SPYRE_DIR}/data/Caddyfile.d"

# Initialize database if schema exists
if [[ -f "${SPYRE_DIR}/schema.sql" ]]; then
  log "Initializing SQLite database..."
  sqlite3 "${SPYRE_DIR}/data/spyre.db" < "${SPYRE_DIR}/schema.sql" 2>/dev/null || true
  log "Database initialized: ${SPYRE_DIR}/data/spyre.db"
else
  warn "schema.sql not found — database will be initialized on first build"
fi

# =============================================================================
# Phase 9: systemd + Caddy
# =============================================================================

echo ""
echo -e "${BOLD}── Phase 9: Service Configuration ──${NC}"
echo ""

# systemd unit
sudo tee /etc/systemd/system/spyre.service > /dev/null << EOF
[Unit]
Description=Spyre — Claude Code Infrastructure Orchestrator
After=network.target
Wants=caddy.service

[Service]
Type=simple
User=$(whoami)
Group=$(id -gn)
WorkingDirectory=${SPYRE_DIR}/web
EnvironmentFile=/etc/spyre/env
ExecStart=/usr/bin/node build/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=spyre

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${SPYRE_DIR}/data /tmp ${HOME}/.config/claude-code
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
log "systemd service created (not started — run after first build)"

# Caddy base config
SPYRE_DOMAIN=$(echo "$SPYRE_URL" | sed 's|https\?://||' | sed 's|/.*||')
sudo tee /etc/caddy/Caddyfile > /dev/null << EOF
${SPYRE_DOMAIN} {
    reverse_proxy localhost:3000

    @websockets {
        header Connection *Upgrade*
        header Upgrade websocket
    }
    reverse_proxy @websockets localhost:3000
}

# Dynamic proxy entries managed by Spyre
import ${SPYRE_DIR}/data/Caddyfile.d/*
EOF

sudo systemctl restart caddy >> "$LOG_FILE" 2>&1 || warn "Caddy restart failed — check config"
log "Caddy configured for ${SPYRE_DOMAIN}"

# =============================================================================
# Summary
# =============================================================================

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║              Setup Complete                          ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}✓${NC} System packages installed"
echo -e "  ${GREEN}✓${NC} Node.js $(node -v) installed"
echo -e "  ${GREEN}✓${NC} Claude Code installed"
echo -e "  ${GREEN}✓${NC} SSH keys generated"
echo -e "  ${GREEN}✓${NC} Proxmox host SSH access configured"
echo -e "  ${GREEN}✓${NC} Proxmox connectivity $([ "$HTTP_CODE" = "200" ] && echo "verified" || echo "pending")"
echo -e "  ${GREEN}✓${NC} environment.yaml generated"
echo -e "  ${GREEN}✓${NC} Secrets stored in /etc/spyre/env"
echo -e "  ${GREEN}✓${NC} systemd service configured"
echo -e "  ${GREEN}✓${NC} Caddy reverse proxy configured"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo ""
echo -e "  1. Build the Spyre web application:"
echo -e "     ${CYAN}cd ${SPYRE_DIR}/web && npm install && npm run build${NC}"
echo ""
echo -e "  2. Start the service:"
echo -e "     ${CYAN}sudo systemctl enable --now spyre${NC}"
echo ""
echo -e "  3. Open ${CYAN}${SPYRE_URL}${NC} in your browser"
echo ""
echo -e "  4. Create your admin account (first-boot prompt)"
echo ""
echo -e "  5. Go to Settings → Claude → Authenticate"
echo -e "     (This starts the OAuth flow through your browser)"
echo ""
echo -e "  Full setup log: ${LOG_FILE}"
echo ""
