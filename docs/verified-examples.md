# Spyre — Verified Integration Examples

> **Purpose**: This file contains real, tested commands and their outputs from YOUR
> Proxmox environment. Claude Code references these to match known-working patterns
> rather than guessing at API shapes or flag syntax.
>
> **How to use**: Run each command below on the appropriate machine. Paste the actual
> output. These become ground truth for the Spyre implementation.
>
> Referenced by: `CLAUDE.md`, `docs/implementation-plan.md`

---

## 1. Proxmox API — Authentication Test

Run on: **Spyre controller VM**

```bash
# Replace with your values from environment.yaml
PVE_HOST="YOUR_PVE_IP"
PVE_PORT="8006"
TOKEN_ID="spyre@pam!automation"
TOKEN_SECRET="YOUR_TOKEN_SECRET"

curl -sk -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/version"
```

**Actual output**:
```json
PASTE OUTPUT HERE
```

---

## 2. Proxmox API — List Nodes

Run on: **Spyre controller VM**

```bash
curl -sk -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes"
```

**Actual output**:
```json
PASTE OUTPUT HERE
```

---

## 3. Proxmox API — List Storage

Run on: **Spyre controller VM**

```bash
curl -sk -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/YOUR_NODE/storage"
```

**Actual output**:
```json
PASTE OUTPUT HERE
```

---

## 4. Proxmox API — List Available Templates

Run on: **Spyre controller VM**

```bash
curl -sk -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/YOUR_NODE/storage/local/content?content=vztmpl"
```

**Actual output**:
```json
PASTE OUTPUT HERE
```

If empty, download a template first on the Proxmox host:
```bash
# Run on Proxmox host
pveam update
pveam download local ubuntu-24.04-standard_24.04-2_amd64.tar.zst
```

---

## 5. Proxmox API — Get Next Available VMID

Run on: **Spyre controller VM**

```bash
curl -sk -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/cluster/nextid"
```

**Actual output**:
```json
PASTE OUTPUT HERE
```

---

## 6. Proxmox API — Create LXC Container

Run on: **Spyre controller VM**

> ⚠️ This actually creates a container. Destroy it after testing.

```bash
NEXT_ID=$(curl -sk -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/cluster/nextid" | jq -r '.data')

curl -sk -X POST \
  -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  -d "vmid=${NEXT_ID}" \
  -d "hostname=spyre-test" \
  -d "ostemplate=local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst" \
  -d "cores=1" \
  -d "memory=512" \
  -d "rootfs=local-lvm:4" \
  -d "net0=name=eth0,bridge=vmbr0,ip=dhcp" \
  -d "start=1" \
  --data-urlencode "ssh-public-keys=$(cat ~/.ssh/spyre_ed25519.pub)" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/YOUR_NODE/lxc"
```

**Actual output** (should contain a UPID):
```json
PASTE OUTPUT HERE
```

**VMID used**: `___`

---

## 7. Proxmox API — Check Task Status

Run on: **Spyre controller VM** (use the UPID from step 6)

```bash
UPID="PASTE_UPID_HERE"
# URL-encode the UPID (replace : with %3A)
ENCODED_UPID=$(echo "$UPID" | sed 's/:/%3A/g')

curl -sk -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/YOUR_NODE/tasks/${ENCODED_UPID}/status"
```

**Actual output**:
```json
PASTE OUTPUT HERE
```

---

## 8. Proxmox API — Get Container IP

Run on: **Spyre controller VM** (use VMID from step 6)

```bash
# Method 1: From container config (if static IP)
curl -sk -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/YOUR_NODE/lxc/${NEXT_ID}/config"

# Method 2: From container network interfaces (if DHCP)
curl -sk -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/YOUR_NODE/lxc/${NEXT_ID}/interfaces"
```

**Actual output**:
```json
PASTE OUTPUT HERE
```

**Container IP**: `___`

---

## 9. SSH — Connect to Container from Controller

Run on: **Spyre controller VM** (use IP from step 8)

```bash
ssh -i ~/.ssh/spyre_ed25519 -o StrictHostKeyChecking=accept-new \
  root@CONTAINER_IP "hostname && whoami && uptime"
```

**Actual output**:
```
PASTE OUTPUT HERE
```

---

## 10. SSH + tmux — Session Persistence Test

Run on: **Spyre controller VM**

```bash
# Create a tmux session on the container
ssh -i ~/.ssh/spyre_ed25519 root@CONTAINER_IP \
  "tmux new-session -d -s spyre -x 200 -y 50 && tmux list-sessions"

# List tmux windows
ssh -i ~/.ssh/spyre_ed25519 root@CONTAINER_IP \
  "tmux list-windows -t spyre"

# Create a second window
ssh -i ~/.ssh/spyre_ed25519 root@CONTAINER_IP \
  "tmux new-window -t spyre && tmux list-windows -t spyre"
```

**Actual output**:
```
PASTE OUTPUT HERE
```

---

## 11. Claude Code — Basic Auth Test

Run on: **Spyre controller VM**

```bash
claude -p "echo hello from Spyre" --output-format json 2>&1
```

**Actual output**:
```json
PASTE OUTPUT HERE
```

> If this returns "Invalid API key" or "Please run /login", Claude Code is not yet
> authenticated. That's fine — auth will happen via the Spyre web UI after Phase 4.
> Just note the error message here so Claude Code knows what to expect.

---

## 12. Proxmox API — Destroy Test Container

Run on: **Spyre controller VM** (clean up from step 6)

```bash
# Stop first if running
curl -sk -X POST \
  -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/YOUR_NODE/lxc/${NEXT_ID}/status/stop"

# Wait a few seconds, then destroy
sleep 5
curl -sk -X DELETE \
  -H "Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}" \
  "https://${PVE_HOST}:${PVE_PORT}/api2/json/nodes/YOUR_NODE/lxc/${NEXT_ID}?purge=1"
```

**Actual output**:
```json
PASTE OUTPUT HERE
```

---

## Notes

*Add any environment-specific quirks you discovered while running these tests:*

- 
- 
- 
