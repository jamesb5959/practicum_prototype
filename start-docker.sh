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

case "${1:-}" in
  up)
    ensure_env_files
    check_port_conflict
    docker compose -f docker-compose.full.yml up -d
    LOCAL_IP="$(detect_local_ip || true)"
    echo "Docker stack started."
    echo "App: http://localhost:5173"
    echo "Keycloak: http://localhost:8080"
    if [ -n "${LOCAL_IP:-}" ]; then
      echo "LAN App: http://${LOCAL_IP}:5173"
      echo "LAN Keycloak: http://${LOCAL_IP}:8080"
    fi
    ;;
  down)
    ensure_env_files
    docker compose -f docker-compose.full.yml down
    ;;
  reset)
    ensure_env_files
    docker compose -f docker-compose.full.yml down -v
    ;;
  *)
    echo "Usage: $0 {up|down|reset}"
    echo "  up    -> start app, Keycloak, and Postgres"
    echo "  down  -> stop containers"
    echo "  reset -> stop containers and remove volumes"
    exit 1
    ;;
esac
