#!/bin/bash
# sonotxt worker deploy — rsync + setup on a vast.ai instance
#
# usage:
#   ./deploy.sh                    # deploy to 5070 Ti (default)
#   ./deploy.sh 32665845           # deploy to specific instance ID
#   ./deploy.sh setup              # full setup (install deps + start)
#   ./deploy.sh restart            # just restart services
#   ./deploy.sh status             # check health
#   ./deploy.sh logs               # tail logs
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SECRETS_DIR="$SCRIPT_DIR/../secrets"
SSH_KEY="$HOME/.ssh/id_claude"

# default to 5070 Ti instance
INSTANCE_ID="${1:-32853589}"

# if first arg is a command, use default instance
case "${1:-}" in
    setup|restart|status|logs|ssh)
        CMD="$1"
        INSTANCE_ID="${2:-32853589}"
        ;;
    *)
        CMD="${2:-setup}"
        ;;
esac

# resolve SSH connection from vast.ai
echo ">>> resolving instance $INSTANCE_ID..."
SSH_URL=$(vastai ssh-url "$INSTANCE_ID" 2>/dev/null)
SSH_HOST=$(echo "$SSH_URL" | sed 's|ssh://root@||' | cut -d: -f1)
SSH_PORT=$(echo "$SSH_URL" | sed 's|ssh://root@||' | cut -d: -f2)
SSH_OPTS="-o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i $SSH_KEY -p $SSH_PORT"

echo ">>> $SSH_HOST:$SSH_PORT (instance $INSTANCE_ID)"

do_ssh() {
    ssh $SSH_OPTS "root@$SSH_HOST" "$@"
}

do_rsync() {
    rsync -avz --progress -e "ssh $SSH_OPTS" "$@"
}

case "$CMD" in
    setup)
        echo ">>> syncing worker files..."
        do_rsync \
            "$SCRIPT_DIR/server.py" \
            "$SCRIPT_DIR/llm_server.py" \
            "$SCRIPT_DIR/setup.sh" \
            "root@$SSH_HOST:/tmp/sonotxt-worker/"

        echo ">>> running setup..."
        do_ssh "cd /tmp/sonotxt-worker && bash setup.sh"

        echo ">>> starting services..."
        do_ssh "/opt/sonotxt/start.sh"
        ;;

    restart)
        echo ">>> syncing server files..."
        do_rsync \
            "$SCRIPT_DIR/server.py" \
            "$SCRIPT_DIR/llm_server.py" \
            "root@$SSH_HOST:/opt/sonotxt/"
        do_ssh "mv /opt/sonotxt/server.py /opt/sonotxt/speech_server.py 2>/dev/null || true"

        echo ">>> restarting services..."
        do_ssh "/opt/sonotxt/stop.sh && sleep 2 && /opt/sonotxt/start.sh"
        ;;

    status)
        echo "=== GPU ==="
        do_ssh "nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu --format=csv,noheader"
        echo ""
        echo "=== speech (8080) ==="
        do_ssh "curl -sf http://localhost:8080/health | python3 -m json.tool" 2>/dev/null || echo "DOWN"
        echo ""
        echo "=== llm (8090) ==="
        do_ssh "curl -sf http://localhost:8090/health | python3 -m json.tool" 2>/dev/null || echo "DOWN"
        ;;

    logs)
        do_ssh "tail -50 /tmp/speech_server.log /tmp/llm_server.log"
        ;;

    ssh)
        echo ">>> opening shell..."
        ssh $SSH_OPTS "root@$SSH_HOST"
        ;;

    *)
        echo "usage: $0 [instance_id] [setup|restart|status|logs|ssh]"
        exit 1
        ;;
esac
