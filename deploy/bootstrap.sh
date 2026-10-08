#!/usr/bin/env bash
# One-time setup of a brand-new Ubuntu 24.04 server for Penny (README, "Putting Penny online"). Run it once, as root:
#     bash bootstrap.sh
# It updates the system, installs Docker, makes a swap file, makes a normal user "penny" (not root), turns on a firewall that lets in only
# SSH, HTTP and HTTPS, switches off password logins over SSH (keys only), and turns on automatic security updates and brute-force protection.
# Running it again is harmless.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run this as root:  sudo bash bootstrap.sh"; exit 1; }
USER_NAME=penny
export DEBIAN_FRONTEND=noninteractive

echo "==> Updating the system"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades git

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> A swap file (a small server can run out of memory while building)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> A normal user, ${USER_NAME}, for running Penny"
id "$USER_NAME" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$USER_NAME"
usermod -aG docker "$USER_NAME"
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
# Your key comes from the account you logged in with: root on DigitalOcean, or the sudo user (azureuser) on Azure/AWS. Only plain key lines are
# copied: Azure's root file starts with a line that forces a "log in as azureuser" message, and copying it would lock the new user out.
KEY_SOURCES="/root/.ssh/authorized_keys"
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ] && [ -d "/home/$SUDO_USER" ]; then
  KEY_SOURCES="/home/$SUDO_USER/.ssh/authorized_keys $KEY_SOURCES"
fi
for src in $KEY_SOURCES; do
  [ -s "$src" ] && grep -E '^(ssh-|ecdsa-|sk-)' "$src" >> "/home/$USER_NAME/.ssh/authorized_keys" || true
done
if [ -s "/home/$USER_NAME/.ssh/authorized_keys" ]; then
  sort -u -o "/home/$USER_NAME/.ssh/authorized_keys" "/home/$USER_NAME/.ssh/authorized_keys"
  chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"
  chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"
fi

echo "==> Firewall: only SSH, HTTP and HTTPS get in"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> SSH: keys only (only if a key is in place, or you would lock yourself out)"
if [ -s "/home/$USER_NAME/.ssh/authorized_keys" ]; then
  cat > /etc/ssh/sshd_config.d/99-penny.conf <<'SSHD'
PasswordAuthentication no
PermitRootLogin prohibit-password
SSHD
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
else
  echo "WARNING: no SSH key was found, so password logins are left on. Add your key and run this again."
fi

echo "==> Automatic security updates and brute-force protection"
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

echo
echo "Done. From your computer, log in as the new user:   ssh ${USER_NAME}@<this server's address>"
echo "Then follow the README (\"Putting Penny online\") from the step that gets the code."
