#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Scryve Fiber Node Installer
#  Installs and configures a Fiber Network Node (fnn) on Ubuntu/Debian.
#  Version: 1.0.0  |  Supports: mainnet + testnet
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Versions ──────────────────────────────────────────────────────────────────
FNN_VERSION="v0.7.1"
CKB_CLI_VERSION="v1.9.0"

# ── Mainnet values ────────────────────────────────────────────────────────────
MAINNET_FNN_URL="https://github.com/nervosnetwork/fiber/releases/download/${FNN_VERSION}/fnn_${FNN_VERSION}_x86_64-unknown-linux-gnu.tar.gz"
MAINNET_CKB_RPC="https://mainnet.ckb.dev/rpc"
MAINNET_BOOTNODE_1="/ip4/43.199.24.44/tcp/8228/p2p/QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v"
MAINNET_BOOTNODE_2="/ip4/54.255.71.126/tcp/8228/p2p/QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2"

# ── Testnet values ────────────────────────────────────────────────────────────
TESTNET_CKB_RPC="https://testnet.ckbapp.dev/"
TESTNET_BOOTNODE_1="/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy"
TESTNET_BOOTNODE_2="/ip4/16.163.7.105/tcp/8228/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV"

# ── CKB CLI ───────────────────────────────────────────────────────────────────
CKB_CLI_URL="https://github.com/nervosnetwork/ckb-cli/releases/download/${CKB_CLI_VERSION}/ckb-cli_${CKB_CLI_VERSION}_x86_64-unknown-linux-gnu.tar.gz"

# ── State ─────────────────────────────────────────────────────────────────────
INSTALL_DIR="$HOME/fiber-node"
NETWORK="mainnet"
VPS_IP=""
NODE_ALIAS="scryve-node"
NODE_PASSWORD=""
SYSTEMD_USER=""
INSTALL_DASHBOARD=false

# ─────────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────────

print_banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ███████╗██╗██████╗ ███████╗██████╗ "
  echo "  ██╔════╝██║██╔══██╗██╔════╝██╔══██╗"
  echo "  █████╗  ██║██████╔╝█████╗  ██████╔╝"
  echo "  ██╔══╝  ██║██╔══██╗██╔══╝  ██╔══██╗"
  echo "  ██║     ██║██████╔╝███████╗██║  ██║"
  echo "  ╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝"
  echo -e "${RESET}"
  echo -e "${BOLD}  Fiber Network Node Installer${RESET}"
  echo -e "  Guides you through running your own Fiber node step by step."
  echo ""
}

info() {
  echo -e "${BLUE}ℹ${RESET}  $*"
}

ok() {
  echo -e "${GREEN}✓${RESET}  $*"
}

warn() {
  echo -e "${YELLOW}⚠${RESET}  $*"
}

error() {
  echo -e "${RED}✗  ERROR: $*${RESET}" >&2
}

step() {
  echo ""
  echo -e "${BOLD}${CYAN}── Step $1: $2 ──────────────────────────────────────${RESET}"
  echo ""
}

explain() {
  echo -e "${YELLOW}  What this does:${RESET} $*"
  echo ""
}

confirm() {
  local prompt="${1:-Continue?}"
  echo ""
  read -rp "  $(echo -e "${BOLD}${prompt} [y/N]${RESET} ")" answer
  case "${answer,,}" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

confirm_required() {
  local prompt="${1:-Are you sure?}"
  local warning="${2:-}"
  echo ""
  if [[ -n "$warning" ]]; then
    warn "$warning"
  fi
  read -rp "  $(echo -e "${BOLD}${RED}${prompt} [yes/N]${RESET} ")" answer
  if [[ "${answer}" == "yes" ]]; then
    return 0
  else
    info "Skipped."
    return 1
  fi
}

prompt_value() {
  local var_name="$1"
  local prompt="$2"
  local default="${3:-}"
  local value=""

  if [[ -n "$default" ]]; then
    read -rp "  ${prompt} [${default}]: " value
    value="${value:-$default}"
  else
    while [[ -z "$value" ]]; do
      read -rp "  ${prompt}: " value
    done
  fi

  printf -v "$var_name" '%s' "$value"
}

prompt_password() {
  local var_name="$1"
  local prompt="$2"
  local value=""
  local confirm_val=""

  while true; do
    read -rsp "  ${prompt}: " value
    echo ""
    read -rsp "  Confirm password: " confirm_val
    echo ""
    if [[ "$value" == "$confirm_val" ]] && [[ -n "$value" ]]; then
      break
    else
      warn "Passwords don't match or are empty. Try again."
    fi
  done

  printf -v "$var_name" '%s' "$value"
}

check_command() {
  command -v "$1" &>/dev/null
}

download() {
  local url="$1"
  local dest="$2"
  if check_command wget; then
    wget -q --show-progress -O "$dest" "$url"
  elif check_command curl; then
    curl -L --progress-bar -o "$dest" "$url"
  else
    error "Neither wget nor curl found. Please install one and re-run."
    exit 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 0: Welcome + pre-flight checks
# ─────────────────────────────────────────────────────────────────────────────

preflight() {
  print_banner

  echo -e "  This installer will set up a ${BOLD}Fiber Network Node${RESET} on your server."
  echo "  Fiber is CKB's Layer 2 payment network — it lets Scryve send instant,"
  echo "  near-free payments without waiting for a blockchain transaction every time."
  echo ""
  echo "  The installer will:"
  echo "    1. Check your system is ready"
  echo "    2. Set up firewall rules"
  echo "    3. Download and install ckb-cli and the fnn binary"
  echo "    4. Generate your node's wallet"
  echo "    5. Write a config file"
  echo "    6. Test that the node starts correctly"
  echo "    7. Set up the node as a background service"
  echo "    8. Optionally install the Fiber Dashboard web UI"
  echo ""
  echo "  Estimated time: 15–30 minutes"
  echo ""

  if ! confirm "Ready to begin?"; then
    echo "  Come back when you're ready. Bye!"
    exit 0
  fi

  echo ""
  info "Checking your system..."

  # OS check
  if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    if [[ "$ID" == "ubuntu" ]] || [[ "$ID_LIKE" =~ "debian" ]] || [[ "$ID" == "debian" ]]; then
      ok "Operating system: ${PRETTY_NAME}"
    else
      warn "This installer is designed for Ubuntu/Debian. Your OS: ${PRETTY_NAME}"
      warn "It may still work, but you might need to adjust some commands."
      if ! confirm "Continue anyway?"; then exit 1; fi
    fi
  else
    warn "Cannot detect OS. Proceeding anyway."
  fi

  # Architecture check
  ARCH=$(uname -m)
  if [[ "$ARCH" != "x86_64" ]]; then
    error "This installer downloads x86_64 binaries. Your architecture: ${ARCH}"
    error "ARM64/other architectures require compiling fnn from source."
    exit 1
  fi
  ok "Architecture: x86_64"

  # Required tools
  for cmd in tar gzip systemctl; do
    if check_command "$cmd"; then
      ok "Found: $cmd"
    else
      error "Required tool not found: $cmd. Please install it and re-run."
      exit 1
    fi
  done

  # Download tool
  if check_command wget; then
    ok "Download tool: wget"
  elif check_command curl; then
    ok "Download tool: curl"
  else
    error "Please install wget or curl and re-run."
    exit 1
  fi

  # Check we're not running as root
  if [[ "$EUID" -eq 0 ]]; then
    warn "You are running as root."
    warn "It's safer to run Fiber as a non-root user."
    info "If you want to continue as root anyway, the node will run as root."
    if ! confirm "Continue as root?"; then
      echo ""
      echo "  To create a non-root user and switch to it:"
      echo "    adduser scryve"
      echo "    usermod -aG sudo scryve"
      echo "    su - scryve"
      echo "  Then re-run this installer."
      exit 0
    fi
    SYSTEMD_USER="root"
  else
    SYSTEMD_USER="$USER"
    ok "Running as: $USER (non-root)"
  fi

  ok "Pre-flight checks passed."
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Network selection
# ─────────────────────────────────────────────────────────────────────────────

select_network() {
  step "1" "Choose Your Network"

  explain "Mainnet is the live CKB network where real funds are used. Testnet is for testing with fake CKB — great for trying things out before committing real funds."

  echo "  Which network do you want to run on?"
  echo "    1) Mainnet  — real CKB, real payments (recommended for production)"
  echo "    2) Testnet  — test CKB only, safe to experiment"
  echo ""

  while true; do
    read -rp "  Enter 1 or 2: " choice
    case "$choice" in
      1)
        NETWORK="mainnet"
        ok "Selected: Mainnet"
        break
        ;;
      2)
        NETWORK="testnet"
        ok "Selected: Testnet"
        warn "Testnet CKB has no real value. Get test CKB from the faucet at: https://faucet.nervos.org"
        break
        ;;
      *)
        warn "Please enter 1 or 2."
        ;;
    esac
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Get VPS public IP and node alias
# ─────────────────────────────────────────────────────────────────────────────

get_node_config() {
  step "2" "Node Identity"

  explain "Your node needs to announce its public IP address so other Fiber nodes on the network can connect to it. It also needs a friendly name (alias) — this is just a label visible in the network."

  echo "  Trying to detect your public IP automatically..."
  AUTO_IP=""
  if check_command curl; then
    AUTO_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || true)
  elif check_command wget; then
    AUTO_IP=$(wget -qO- --timeout=5 https://api.ipify.org 2>/dev/null || true)
  fi

  if [[ -n "$AUTO_IP" ]]; then
    ok "Detected public IP: $AUTO_IP"
    if confirm "Use $AUTO_IP as your node's public IP?"; then
      VPS_IP="$AUTO_IP"
    else
      prompt_value VPS_IP "Enter your server's public IP address"
    fi
  else
    warn "Could not auto-detect IP."
    prompt_value VPS_IP "Enter your server's public IP address (find this in your hosting panel)"
  fi

  echo ""
  prompt_value NODE_ALIAS "Choose a name for your node (visible on the network)" "scryve-node"
  # Strip chars that would break a YAML double-quoted string
  NODE_ALIAS=$(echo "$NODE_ALIAS" | tr -d '"\\' | tr -d '\000-\037')
  [[ -z "$NODE_ALIAS" ]] && NODE_ALIAS="fiber-node"
  ok "Node alias: $NODE_ALIAS"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Firewall setup
# ─────────────────────────────────────────────────────────────────────────────

setup_firewall() {
  step "3" "Firewall Setup"

  explain "The Fiber p2p port (8228) must be open so other nodes can connect to yours. The RPC port (8227) must be CLOSED to the internet — it controls your funds and should only be accessible locally."

  if ! check_command ufw; then
    warn "ufw is not installed. Attempting to install..."
    sudo apt-get install -y ufw
  fi

  info "Current firewall status:"
  sudo ufw status 2>/dev/null || true
  echo ""

  if confirm "Set up firewall rules now? (This will enable ufw if not already running)"; then
    sudo ufw allow OpenSSH
    ok "SSH (port 22): allowed"

    sudo ufw allow 8228/tcp
    ok "Fiber p2p (port 8228): allowed"

    sudo ufw deny 8227/tcp
    ok "Fiber RPC (port 8227): blocked from internet"

    echo ""
    warn "About to enable the firewall. Make sure SSH (port 22) is allowed (it is — we just set it)."
    if confirm "Enable firewall now?"; then
      sudo ufw --force enable
      ok "Firewall enabled."
      sudo ufw status
    else
      warn "Firewall not enabled. Run 'sudo ufw enable' manually before going to production."
    fi
  else
    warn "Firewall setup skipped. Remember to configure it before going to production."
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Install ckb-cli
# ─────────────────────────────────────────────────────────────────────────────

install_ckb_cli() {
  step "4" "Install ckb-cli"

  if check_command ckb-cli; then
    INSTALLED_VER=$(ckb-cli --version 2>/dev/null | head -1 || true)
    ok "ckb-cli is already installed: $INSTALLED_VER"
    info "Skipping download."
    return
  fi

  explain "ckb-cli is a command-line tool for managing CKB wallets. You'll use it once to generate your node's private key. After that, the Fiber node uses the key directly."

  info "Downloading ckb-cli ${CKB_CLI_VERSION}..."
  TMPDIR_CLI=$(mktemp -d)
  download "$CKB_CLI_URL" "${TMPDIR_CLI}/ckb-cli.tar.gz"

  info "Extracting..."
  tar xzf "${TMPDIR_CLI}/ckb-cli.tar.gz" -C "${TMPDIR_CLI}"

  # The extracted binary might be in a subdirectory
  CLI_BIN=$(find "${TMPDIR_CLI}" -name "ckb-cli" -type f | head -1)
  if [[ -z "$CLI_BIN" ]]; then
    error "Could not find ckb-cli binary after extraction."
    exit 1
  fi

  sudo mv "$CLI_BIN" /usr/local/bin/ckb-cli
  chmod +x /usr/local/bin/ckb-cli
  rm -rf "${TMPDIR_CLI}"

  ok "ckb-cli installed: $(ckb-cli --version | head -1)"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Download fnn binary
# ─────────────────────────────────────────────────────────────────────────────

install_fnn() {
  step "5" "Download Fiber Node Binary (fnn)"

  explain "The Fiber Network Node (fnn) is the actual node software. It runs as a background process and manages your payment channels. It's a single binary — no complex installation needed."

  mkdir -p "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR/ckb"

  if [[ -f "$INSTALL_DIR/fnn" ]]; then
    EXISTING_VER=$("$INSTALL_DIR/fnn" --version 2>/dev/null || echo "unknown")
    ok "fnn already exists: $EXISTING_VER"
    if ! confirm "Re-download fnn ${FNN_VERSION}?"; then
      return
    fi
  fi

  info "Downloading fnn ${FNN_VERSION}..."

  # fnn is a single binary for both networks — the network is determined by config.yml.
  FNN_URL="$MAINNET_FNN_URL"

  TMPDIR_FNN=$(mktemp -d)
  download "$FNN_URL" "${TMPDIR_FNN}/fnn.tar.gz"

  info "Extracting..."
  tar xzf "${TMPDIR_FNN}/fnn.tar.gz" -C "${TMPDIR_FNN}"

  FNN_BIN=$(find "${TMPDIR_FNN}" -name "fnn" -type f | head -1)
  if [[ -z "$FNN_BIN" ]]; then
    error "Could not find fnn binary after extraction."
    exit 1
  fi

  mv "$FNN_BIN" "$INSTALL_DIR/fnn"
  chmod +x "$INSTALL_DIR/fnn"
  rm -rf "${TMPDIR_FNN}"

  ok "fnn installed: $("$INSTALL_DIR/fnn" --version 2>/dev/null || echo 'installed')"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: Download config.yml
# ─────────────────────────────────────────────────────────────────────────────

write_config() {
  step "6" "Download Node Configuration"

  explain "We'll fetch the official config for fnn ${FNN_VERSION} directly from the Fiber repository — this ensures script hashes and bootnodes are always correct for your installed version — then patch it with your settings."

  if [[ -f "$INSTALL_DIR/config.yml" ]]; then
    warn "config.yml already exists at $INSTALL_DIR/config.yml"
    if ! confirm "Overwrite it with a fresh config?"; then
      info "Keeping existing config."
      return
    fi
    cp "$INSTALL_DIR/config.yml" "$INSTALL_DIR/config.yml.backup.$(date +%Y%m%d%H%M%S)"
    ok "Old config backed up."
  fi

  # Try to download the versioned config from the official nervosnetwork/fiber repo.
  # Using the exact version tag ensures the script hashes match the installed fnn binary.
  CONFIG_URL="https://raw.githubusercontent.com/nervosnetwork/fiber/${FNN_VERSION}/config/${NETWORK}/config.yml"
  DOWNLOADED=false

  info "Fetching official ${NETWORK} config for ${FNN_VERSION} from nervosnetwork/fiber..."
  if curl -sSfL "$CONFIG_URL" -o "$INSTALL_DIR/config.yml" 2>/dev/null || \
     wget -qO  "$INSTALL_DIR/config.yml" "$CONFIG_URL" 2>/dev/null; then
    if [[ -s "$INSTALL_DIR/config.yml" ]]; then
      DOWNLOADED=true
      ok "Official config downloaded."
    fi
  fi

  if [[ "$DOWNLOADED" == false ]]; then
    warn "Could not download official config — using built-in defaults."
    rm -f "$INSTALL_DIR/config.yml"
    if [[ "$NETWORK" == "mainnet" ]]; then
      cat > "$INSTALL_DIR/config.yml" << 'EOF'
fiber:
  listening_addr: "/ip4/0.0.0.0/tcp/8228"
  bootnode_addrs:
    - "/ip4/43.199.24.44/tcp/8228/p2p/QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v"
    - "/ip4/54.255.71.126/tcp/8228/p2p/QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2"
  announce_listening_addr: true
  announced_addrs:
    - "/ip4/__VPS_IP__/tcp/8228"
  node_name: "__NODE_ALIAS__"
  chain: mainnet
  private_key_path: "ckb/key"
  scripts:
    - name: FundingLock
      script:
        code_hash: 0xe45b1f8f21bff23137035a3ab751d75b36a981deec3e7820194b9c042967f4f1
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x64818d82a372312fb007c480391e1b9759d21b2c7f7959b9c177d72cdc243394
        - cell_dep:
            out_point:
              tx_hash: 0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6
              index: 0x0
            dep_type: code
    - name: CommitmentLock
      script:
        code_hash: 0x2d45c4d3ed3e942f1945386ee82a5d1b7e4bb16d7fe1ab015421174ab747406c
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0xdb16e6dcb17f670e5fb7c556d81e522ec5edb069ad2fa3e898e7ccea6c26a39f
        - cell_dep:
            out_point:
              tx_hash: 0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6
              index: 0x0
            dep_type: code

rpc:
  listening_addr: "127.0.0.1:8227"

ckb:
  rpc_url: "https://mainnet.ckb.dev/rpc"

services:
  - fiber
  - rpc
  - ckb
EOF
    else
      cat > "$INSTALL_DIR/config.yml" << 'EOF'
fiber:
  listening_addr: "/ip4/0.0.0.0/tcp/8228"
  bootnode_addrs:
    - "/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy"
    - "/ip4/16.163.7.105/tcp/8228/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV"
  announce_listening_addr: true
  announced_addrs:
    - "/ip4/__VPS_IP__/tcp/8228"
  node_name: "__NODE_ALIAS__"
  chain: testnet
  private_key_path: "ckb/key"
  scripts:
    - name: FundingLock
      script:
        code_hash: 0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6
        - cell_dep:
            out_point:
              tx_hash: 0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7
              index: 0x0
            dep_type: code
    - name: CommitmentLock
      script:
        code_hash: 0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b
        - cell_dep:
            out_point:
              tx_hash: 0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7
              index: 0x0
            dep_type: code

rpc:
  listening_addr: "127.0.0.1:8227"

ckb:
  rpc_url: "https://testnet.ckbapp.dev/"

services:
  - fiber
  - rpc
  - ckb
EOF
    fi
    # Substitute placeholders in the built-in fallback config
    sed -i "s|__VPS_IP__|${VPS_IP}|g; s|__NODE_ALIAS__|${NODE_ALIAS}|g" "$INSTALL_DIR/config.yml"
    ok "Config written to $INSTALL_DIR/config.yml"
    info "Review with: cat $INSTALL_DIR/config.yml"
    return
  fi

  # Patch the downloaded official config with our settings.
  # Python3 is used for reliable YAML field replacement (always available on Ubuntu).
  info "Patching config with your settings..."
  python3 - "$INSTALL_DIR/config.yml" "$VPS_IP" "$NODE_ALIAS" << 'PYEOF'
import sys, re

path, vps_ip, node_alias = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    c = f.read()

# private_key_path — ensure it points to ckb/key relative to the install dir
c = re.sub(r'(private_key_path:\s*).*', r'\1"ckb/key"', c)

# node_name — replace if present, otherwise insert after the first listening_addr line
if re.search(r'^\s+node_name:', c, re.MULTILINE):
    c = re.sub(r'^(\s+node_name:\s*).*', rf'\g<1>"{node_alias}"', c, flags=re.MULTILINE)
else:
    c = re.sub(r'^(\s+listening_addr:.*\n)', rf'\1  node_name: "{node_alias}"\n', c, flags=re.MULTILINE, count=1)

# announced_addrs — replace whatever value is there (empty list, existing IPs, etc.)
c = re.sub(
    r'(\s+announced_addrs:).*?(?=\n\s+\w|\nrpc:|\Z)',
    rf'\1\n    - "/ip4/{vps_ip}/tcp/8228"',
    c, flags=re.DOTALL
)

# rpc listening_addr — ensure it's localhost only (never exposed to internet)
c = re.sub(
    r'(^rpc:\n(?:[ \t]+.*\n)*?[ \t]+listening_addr:)[ \t]*.*',
    r'\1 "127.0.0.1:8227"',
    c, flags=re.MULTILINE
)

with open(path, 'w') as f:
    f.write(c)
PYEOF

  ok "Config written to $INSTALL_DIR/config.yml"
  info "Review with: cat $INSTALL_DIR/config.yml"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 7: Generate node wallet
# ─────────────────────────────────────────────────────────────────────────────

generate_wallet() {
  step "7" "Generate Node Wallet"

  explain "Your Fiber node needs a CKB wallet — this is the account that holds the CKB used to open payment channels. The private key is generated on your server and never leaves it."

  if [[ -f "$INSTALL_DIR/ckb/key" ]]; then
    ok "A key file already exists at $INSTALL_DIR/ckb/key"
    warn "Generating a new key will REPLACE the existing one. Only do this if you haven't funded the old one yet."
    if ! confirm_required "Replace existing key?" "This cannot be undone."; then
      info "Keeping existing key."
      return
    fi
  fi

  info "Generating a new CKB account..."
  echo ""
  echo -e "${YELLOW}  ── Your new node address ──${RESET}"
  echo ""

  # Generate account and capture output
  ACCOUNT_OUTPUT=$(ckb-cli account new 2>&1 || true)
  echo "$ACCOUNT_OUTPUT"

  # Try to extract the address and lock_arg
  LOCK_ARG=$(echo "$ACCOUNT_OUTPUT" | grep -oP 'lock_arg: \K0x[0-9a-fA-F]+' || true)
  if [[ "$NETWORK" == "mainnet" ]]; then
    NODE_ADDRESS=$(echo "$ACCOUNT_OUTPUT" | grep -A1 'address:' | grep 'mainnet:' | awk '{print $2}' || true)
  else
    NODE_ADDRESS=$(echo "$ACCOUNT_OUTPUT" | grep -A1 'address:' | grep 'testnet:' | awk '{print $2}' || true)
  fi

  echo ""
  if [[ -n "$LOCK_ARG" ]]; then
    echo -e "  ${BOLD}Lock arg:${RESET} ${LOCK_ARG}"
  fi
  if [[ -n "$NODE_ADDRESS" ]]; then
    echo -e "  ${BOLD}${NETWORK^} address:${RESET} ${NODE_ADDRESS}"
  fi
  echo ""
  warn "SAVE THE OUTPUT ABOVE. If you lose this information you may not be able to recover funds."
  echo ""

  if [[ -z "$LOCK_ARG" ]]; then
    warn "Could not auto-detect lock_arg from ckb-cli output."
    prompt_value LOCK_ARG "Paste your lock_arg (starts with 0x) from the output above"
  fi

  # Export with retry — wrong keystore password is recoverable
  while true; do
    info "Exporting private key — enter your keystore password when prompted..."
    rm -f "${INSTALL_DIR}/ckb/exported-key"
    ckb-cli account export \
      --lock-arg "${LOCK_ARG}" \
      --extended-privkey-path "${INSTALL_DIR}/ckb/exported-key" || true
    if [[ -f "${INSTALL_DIR}/ckb/exported-key" ]]; then
      break
    fi
    warn "Export failed — wrong keystore password? Please try again."
  done

  # Extract only the first line (the actual private key)
  head -n 1 "${INSTALL_DIR}/ckb/exported-key" > "${INSTALL_DIR}/ckb/key"
  rm -f "${INSTALL_DIR}/ckb/exported-key"
  chmod 600 "${INSTALL_DIR}/ckb/key"

  ok "Private key saved to $INSTALL_DIR/ckb/key (permissions: 600)"
  echo ""
  echo -e "  ${BOLD}${GREEN}═══════════════════════════════════════════════${RESET}"
  echo -e "  ${BOLD}${GREEN}  ACTION REQUIRED: Fund your node wallet${RESET}"
  echo -e "  ${BOLD}${GREEN}═══════════════════════════════════════════════${RESET}"
  echo ""

  if [[ "$NETWORK" == "mainnet" ]]; then
    echo "  Send at least 1,000 CKB to your node's address to open channels."
    echo "  We recommend 10,000 CKB for comfortable operation."
    echo ""
    if [[ -n "$NODE_ADDRESS" ]]; then
      echo -e "  ${BOLD}Send CKB to:${RESET}"
      echo "    $NODE_ADDRESS"
    else
      echo "  Copy the mainnet address from the output above and send CKB to it."
    fi
    echo ""
    echo "  To send: open JoyID → tap Send → paste the address above → enter amount"
    echo "  Verify on: https://explorer.nervos.org"
  else
    echo "  Get free testnet CKB from the faucet:"
    echo "    https://faucet.nervos.org"
    if [[ -n "$NODE_ADDRESS" ]]; then
      echo ""
      echo -e "  ${BOLD}Your testnet address:${RESET}"
      echo "    $NODE_ADDRESS"
    fi
  fi

  echo ""
  warn "The node won't be able to open channels until the wallet is funded."
  read -rp "  Press ENTER when you've sent CKB to the address (or press ENTER to skip funding for now)..."
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 8: Set node password + test run
# ─────────────────────────────────────────────────────────────────────────────

test_node() {
  step "8" "Set Password and Test the Node"

  explain "The node encrypts your private key with a password. This password is needed every time the node starts. We'll run it briefly to make sure everything works, then set it up as a background service."

  echo ""
  echo "  Choose a strong password. You'll need this to start the node."
  echo "  Store it somewhere safe — without it, you can't restart the node."
  echo ""
  prompt_password NODE_PASSWORD "Node password"

  echo ""
  info "Starting the node for a quick test (will run for 15 seconds)..."
  echo ""

  cd "$INSTALL_DIR"

  # Run node in background briefly
  FIBER_SECRET_KEY_PASSWORD="$NODE_PASSWORD" RUST_LOG=warn \
    "$INSTALL_DIR/fnn" --config "$INSTALL_DIR/config.yml" -d "$INSTALL_DIR" &
  FNN_PID=$!

  # Wait for it to start
  sleep 8

  # Test RPC
  echo ""
  info "Testing RPC connection..."
  RPC_TEST=""
  for i in 1 2 3 4 5; do
    RPC_TEST=$(curl -s --max-time 3 -X POST http://localhost:8227 \
      -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"node_info","params":[]}' 2>/dev/null || true)
    if echo "$RPC_TEST" | grep -q '"result"'; then
      break
    fi
    sleep 3
  done

  # Stop the test node
  kill "$FNN_PID" 2>/dev/null || true
  wait "$FNN_PID" 2>/dev/null || true
  sleep 2

  if echo "$RPC_TEST" | grep -q '"result"'; then
    ok "Node started and RPC is responding!"
    NODE_ALIAS_CONFIRMED=$(echo "$RPC_TEST" | grep -oP '"node_name"\s*:\s*"\K[^"]+' || echo "$NODE_ALIAS")
    ok "Node alias confirmed: $NODE_ALIAS_CONFIRMED"
  else
    warn "RPC test didn't get a response — the node may need more time to start."
    warn "This is sometimes normal on first run. The systemd service will handle retries."
    info "If you continue to have issues, check logs with: journalctl -u fiber-node -f"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 9: Set up systemd service
# ─────────────────────────────────────────────────────────────────────────────

setup_systemd() {
  step "9" "Set Up Background Service"

  explain "We'll set up the Fiber node as a systemd service. This means it starts automatically when your server boots, and restarts itself if it ever crashes — so you don't have to babysit it."

  SERVICE_FILE="/etc/systemd/system/fiber-node.service"

  cat > /tmp/fiber-node.service << EOF
[Unit]
Description=Fiber Network Node (Scryve)
Documentation=https://github.com/nervosnetwork/fiber
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SYSTEMD_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/fnn --config ${INSTALL_DIR}/config.yml -d ${INSTALL_DIR}
Environment="FIBER_SECRET_KEY_PASSWORD=${NODE_PASSWORD}"
Environment="RUST_LOG=info"
Restart=on-failure
RestartSec=15
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  sudo mv /tmp/fiber-node.service "$SERVICE_FILE"
  ok "Service file written to $SERVICE_FILE"

  sudo systemctl daemon-reload
  sudo systemctl enable fiber-node
  ok "Service enabled (will start on boot)"

  sudo systemctl start fiber-node
  sleep 5

  STATUS=$(sudo systemctl is-active fiber-node 2>/dev/null || echo "unknown")
  if [[ "$STATUS" == "active" ]]; then
    ok "Service is running!"
  else
    warn "Service status: $STATUS"
    warn "Check logs with: sudo journalctl -u fiber-node -f"
  fi

  echo ""
  info "Useful commands:"
  echo "    sudo systemctl status fiber-node     — check if running"
  echo "    sudo systemctl stop fiber-node       — stop the node"
  echo "    sudo systemctl restart fiber-node    — restart the node"
  echo "    sudo journalctl -u fiber-node -f     — watch live logs"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 10: Open first channel
# ─────────────────────────────────────────────────────────────────────────────

first_channel_guide() {
  step "10" "Open Your First Channel"

  explain "A Fiber channel is like a two-way payment pipe between your node and another node. You put CKB into it when you open it, and that becomes your 'outbound liquidity' — how much you can send. You need at least one open channel before payments can flow."

  echo ""
  if [[ "$NETWORK" == "mainnet" ]]; then
    echo "  To open a channel with one of the official Nervos bootstrap nodes:"
    echo ""
    echo "  Run this from your Scryve backend (or any machine with Node.js):"
    echo ""
    echo -e "  ${CYAN}  import { FiberClient, ckbToShannons } from '@scryve-tools/ckb-fiber';"
    echo "  const fiber = new FiberClient('http://localhost:8227');"
    echo "  await fiber.connectPeer({ address: '${MAINNET_BOOTNODE_1}', save: true });"
    echo "  await fiber.openChannel({"
    echo "    peer_id: 'QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v',"
    echo "    funding_amount: ckbToShannons(5000),"
    echo "    public: true"
    echo -e "  });${RESET}"
    echo ""
    echo "  Or use the Fiber Dashboard (if installed) — Peers tab → Quick Connect,"
    echo "  then Channels tab → Open Channel."
  else
    echo "  On testnet, connect to the testnet bootnode and open a channel with some test CKB."
    echo "  Use the Fiber Dashboard after installation to manage channels."
  fi

  echo ""
  info "Channel opening takes one on-chain transaction (~30 seconds to confirm)."
  info "After that, payments through the channel are instant."
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 11: Dashboard
# ─────────────────────────────────────────────────────────────────────────────

install_dashboard_prompt() {
  step "11" "Fiber Dashboard (Optional)"

  explain "The Fiber Dashboard is a web UI that lets you manage your node visually — see channels, send payments, create invoices, and monitor your node health. It runs locally on port 3001 (localhost only — no authentication, so it is not exposed to the internet)."

  if ! confirm "Install the Fiber Dashboard?"; then
    info "Dashboard skipped. Re-run the installer to add it later."
    return
  fi

  # Locate the dashboard source folder — expected next to this installer script.
  # The outer folder contains both ckb-fiber/ (the RPC client) and fiber-dashboard/ (the app).
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  DASHBOARD_OUTER=""
  for candidate in \
      "$SCRIPT_DIR/fiber-dashboard" \
      "$SCRIPT_DIR/../fiber-dashboard" \
      "$HOME/fiber-dashboard"; do
    if [[ -f "$candidate/fiber-dashboard/package.json" ]]; then
      DASHBOARD_OUTER="$candidate"
      break
    fi
  done

  if [[ -z "$DASHBOARD_OUTER" ]]; then
    warn "Dashboard source not found."
    info "Expected the fiber-dashboard/ folder next to this installer script."
    info "Copy the fiber-dashboard/ folder to this server, then re-run the installer."
    return
  fi

  ok "Dashboard source found: $DASHBOARD_OUTER"

  # Check for Node.js
  if ! check_command node; then
    info "Node.js is not installed. Installing LTS via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
    ok "Node.js installed: $(node --version)"
  else
    ok "Node.js: $(node --version)"
  fi

  DASHBOARD_DEST="$INSTALL_DIR/dashboard"

  if [[ -d "$DASHBOARD_DEST" ]]; then
    warn "Dashboard already installed at $DASHBOARD_DEST"
    if ! confirm "Reinstall it?"; then
      info "Keeping existing dashboard."
      INSTALL_DASHBOARD=true
      return
    fi
    rm -rf "$DASHBOARD_DEST"
  fi

  info "Copying dashboard files to $DASHBOARD_DEST..."
  # Copy the outer folder — it contains ckb-fiber/ AND fiber-dashboard/ (inner app).
  # The inner app's server imports ../../ckb-fiber, which resolves correctly once copied.
  cp -r "$DASHBOARD_OUTER" "$DASHBOARD_DEST"
  ok "Dashboard files copied."

  DASHBOARD_APP="$DASHBOARD_DEST/fiber-dashboard"
  TSX_BIN="$DASHBOARD_APP/node_modules/.bin/tsx"

  info "Installing npm dependencies (this may take a minute)..."
  cd "$DASHBOARD_APP"
  npm install 2>&1 | tail -5

  info "Building dashboard frontend..."
  npm run build 2>&1 | tail -5
  ok "Dashboard built."

  # Create systemd service — tsx runs the TypeScript server directly.
  # Binds to 127.0.0.1 only; use an SSH tunnel for remote access.
  cat > /tmp/fiber-dashboard.service << EOF2
[Unit]
Description=Fiber Dashboard (Scryve)
Documentation=https://github.com/nervosnetwork/fiber
After=network-online.target fiber-node.service
Wants=network-online.target

[Service]
Type=simple
User=${SYSTEMD_USER}
WorkingDirectory=${DASHBOARD_APP}
ExecStart=${TSX_BIN} server/index.ts
Environment="FIBER_RPC_URL=http://localhost:8227"
Environment="PORT=3001"
Environment="NODE_ENV=production"
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF2

  sudo mv /tmp/fiber-dashboard.service /etc/systemd/system/fiber-dashboard.service
  sudo systemctl daemon-reload
  sudo systemctl enable fiber-dashboard
  sudo systemctl start fiber-dashboard
  sleep 3

  DASH_STATUS=$(sudo systemctl is-active fiber-dashboard 2>/dev/null || echo "unknown")
  if [[ "$DASH_STATUS" == "active" ]]; then
    ok "Dashboard is running!"
    echo ""
    echo "  Access:  http://localhost:3001"
    echo ""
    warn "The dashboard has NO login protection — do NOT expose port 3001 to the internet."
    info "For remote access, use an SSH tunnel from your own computer:"
    echo "    ssh -L 3001:localhost:3001 ${SYSTEMD_USER}@${VPS_IP}"
    echo "  Then open http://localhost:3001 in your browser."
  else
    warn "Dashboard service status: $DASH_STATUS"
    info "Check logs: sudo journalctl -u fiber-dashboard -f"
  fi

  INSTALL_DASHBOARD=true
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 12: Final summary
# ─────────────────────────────────────────────────────────────────────────────

print_summary() {
  echo ""
  echo -e "${GREEN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════╗"
  echo "  ║         Setup Complete! Your node is running.        ║"
  echo "  ╚══════════════════════════════════════════════════════╝"
  echo -e "${RESET}"

  echo ""
  echo -e "  ${BOLD}Your Fiber node summary:${RESET}"
  echo ""
  echo "    Network:         ${NETWORK}"
  echo "    Node alias:      ${NODE_ALIAS}"
  echo "    Install dir:     ${INSTALL_DIR}"
  echo "    P2P port:        8228 (open to internet)"
  echo "    RPC port:        8227 (local only)"
  echo ""
  if [[ "$INSTALL_DASHBOARD" == true ]]; then
    echo "    Dashboard:       http://localhost:3001  (local access)"
    echo ""
    echo -e "  ${BOLD}Remote dashboard access (run on your local machine):${RESET}"
    echo ""
    echo "    ssh -L 3001:localhost:3001 ${SYSTEMD_USER}@${VPS_IP}"
    echo "  Then open http://localhost:3001 in your browser."
    echo ""
  fi
  echo -e "  ${BOLD}Key management commands:${RESET}"
  echo ""
  echo "    sudo systemctl status fiber-node        — is the node running?"
  echo "    sudo systemctl restart fiber-node       — restart after config changes"
  echo "    sudo journalctl -u fiber-node -f        — watch live logs"
  echo ""
  echo -e "  ${BOLD}Connect Scryve to this node:${RESET}"
  echo ""
  echo "    Add this to your Replit Secrets:"
  echo "      FIBER_NODE_URL=http://${VPS_IP}:8227"
  echo ""
  echo "    (Secure the connection with an SSH tunnel in production — see FIBER-NODE-SETUP.md)"
  echo ""
  echo -e "  ${BOLD}Next steps:${RESET}"
  echo ""
  echo "    1. Make sure your node wallet is funded (${NETWORK})"
  echo "    2. Open a channel with at least one peer (see step 10 above)"
  echo "    3. Add FIBER_NODE_URL to your Scryve backend"
  echo ""
  echo "    Resources:"
  echo "      Fiber docs:    https://docs.fiber.world"
  echo "      CKB Explorer:  https://explorer.nervos.org"
  echo "      Nervos Discord: https://discord.gg/nervos (#fiber channel)"
  echo ""
  echo -e "  ${BOLD}${GREEN}Good luck with your node!${RESET}"
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

main() {
  preflight
  select_network
  get_node_config
  setup_firewall
  install_ckb_cli
  install_fnn
  write_config
  generate_wallet
  test_node
  setup_systemd
  first_channel_guide
  install_dashboard_prompt
  print_summary
}

main "$@"
