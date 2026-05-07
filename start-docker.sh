#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ensure_env_files() {
  if [ ! -f ".env.docker" ]; then
    echo "Missing .env.docker. Run ./setup-docker.sh first."
    exit 1
  fi

  if [ ! -f "keycloak-server/.env" ]; then
    echo "Missing keycloak-server/.env. Run ./setup-docker.sh first."
    exit 1
  fi

  set -a
  source .env.docker
  source keycloak-server/.env
  set +a
}

set_env_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s#^${key}=.*#${key}=${value}#" "$file"
    rm -f "${file}.bak"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

detect_local_ip() {
  local default_iface local_ip
  default_iface="$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}')"

  if [ -n "${default_iface:-}" ]; then
    local_ip="$(ipconfig getifaddr "$default_iface" 2>/dev/null || true)"
    if [ -n "${local_ip:-}" ]; then
      printf '%s\n' "$local_ip"
      return
    fi
  fi

  local_ip="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')"
  if [ -n "${local_ip:-}" ]; then
    printf '%s\n' "$local_ip"
  fi
}

check_port_conflict() {
  local conflict
  conflict="$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0.0.0.0:8080->|:::8080->/ {print $1; exit}')"
  if [ -n "${conflict:-}" ] && [ "$conflict" != "practicum-keycloak" ]; then
    echo "Port 8080 is already in use by container: $conflict"
    echo "Stop that container first, or run ./start-docker.sh down if it belongs to another practicum stack."
    exit 1
  fi
}

sync_keycloak_client() {
  local realm="${KEYCLOAK_REALM:-demo}"
  local client_id="${KEYCLOAK_CLIENT_ID:-svelte-web}"
  local app_base_url="${APP_BASE_URL:-http://localhost:5174}"
  local admin_user="${KEYCLOAK_ADMIN:-admin}"
  local admin_password="${KEYCLOAK_ADMIN_PASSWORD:-Admin123!}"
  local client_uuid=""

  for _ in $(seq 1 30); do
    if docker exec practicum-keycloak /opt/keycloak/bin/kcadm.sh config credentials \
      --server http://localhost:8080 \
      --realm master \
      --user "$admin_user" \
      --password "$admin_password" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  client_uuid="$(
    docker exec practicum-keycloak /opt/keycloak/bin/kcadm.sh get clients \
      -r "$realm" \
      -q clientId="$client_id" \
      --fields id 2>/dev/null |
      sed -n 's/.*"id" : "\([^"]*\)".*/\1/p' |
      head -n 1
  )"

  if [ -z "$client_uuid" ]; then
    echo "Warning: could not find Keycloak client '$client_id' in realm '$realm'."
    return
  fi

  docker exec practicum-keycloak /opt/keycloak/bin/kcadm.sh update "clients/${client_uuid}" \
    -r "$realm" \
    -s "rootUrl=${app_base_url}" \
    -s "redirectUris=[\"${app_base_url}/*\"]" \
    -s "webOrigins=[\"${app_base_url}\"]" >/dev/null
}

case "${1:-}" in
  up)
    ensure_env_files
    check_port_conflict
    MODE="${2:-cpu}"
    PERF_MODE="${3:-normal}"
    COMPOSE_FILES=(-f docker-compose.full.yml)
    if [ "$MODE" = "gpu" ]; then
      COMPOSE_FILES+=(-f docker-compose.gpu.yml)
      echo "GPU Docker mode enabled."
    elif [ "$MODE" != "cpu" ]; then
      echo "Usage: $0 {up|down|reset} [cpu|gpu] [normal|performance]"
      exit 1
    fi
    if [ "$PERF_MODE" = "performance" ]; then
      set_env_key .env.docker PUBLIC_DEMO_PERFORMANCE_MODE true
      echo "Demo performance mode enabled."
    elif [ "$PERF_MODE" = "normal" ]; then
      set_env_key .env.docker PUBLIC_DEMO_PERFORMANCE_MODE false
    else
      echo "Usage: $0 {up|down|reset} [cpu|gpu] [normal|performance]"
      exit 1
    fi
    ensure_env_files
    docker compose "${COMPOSE_FILES[@]}" up -d
    sync_keycloak_client
    LOCAL_IP="$(detect_local_ip || true)"
    echo "Docker stack started."
    echo "App: http://localhost:5174"
    echo "Keycloak: http://localhost:8080"
    if [ -n "${LOCAL_IP:-}" ]; then
      echo "LAN App: http://${LOCAL_IP}:5174"
      echo "LAN Keycloak: http://${LOCAL_IP}:8080"
    fi
    ;;
  down)
    ensure_env_files
    MODE="${2:-cpu}"
    COMPOSE_FILES=(-f docker-compose.full.yml)
    if [ "$MODE" = "gpu" ]; then
      COMPOSE_FILES+=(-f docker-compose.gpu.yml)
    fi
    docker compose "${COMPOSE_FILES[@]}" down
    ;;
  reset)
    ensure_env_files
    MODE="${2:-cpu}"
    COMPOSE_FILES=(-f docker-compose.full.yml)
    if [ "$MODE" = "gpu" ]; then
      COMPOSE_FILES+=(-f docker-compose.gpu.yml)
    fi
    docker compose "${COMPOSE_FILES[@]}" down -v
    ;;
  *)
    echo "Usage: $0 {up|down|reset} [cpu|gpu] [normal|performance]"
    echo "  up    -> start app, Keycloak, and Postgres"
    echo "  down  -> stop containers"
    echo "  reset -> stop containers and remove volumes"
    echo "  cpu   -> default runtime"
    echo "  gpu   -> NVIDIA CUDA runtime"
    echo "  normal/performance -> frontend render profile"
    exit 1
    ;;
esac
