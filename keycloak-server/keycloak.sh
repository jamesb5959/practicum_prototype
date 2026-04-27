#!/usr/bin/env bash
set -e

case "${1:-}" in
  up)
    docker compose up -d
    ;;
  down)
    docker compose down
    ;;
  reset)
    docker compose down -v
    ;;
  *)
    echo "Usage: $0 {up|down|reset}"
    echo "  up    -> start containers"
    echo "  down  -> stop containers"
    echo "  reset -> stop containers and remove volumes"
    exit 1
    ;;
esac
