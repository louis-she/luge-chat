#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="luge@luge.chat"
REMOTE_WWW="~/supabase-project/volumes/www/luge.chat"
REMOTE_CADDY="~/supabase-project/volumes/proxy/caddy"

echo "→ 同步静态文件到服务器"
ssh "$REMOTE" "mkdir -p $REMOTE_WWW/app $REMOTE_WWW/assets $REMOTE_WWW/.well-known"
scp "$ROOT/website/index.html" "$ROOT/website/styles.css" "$REMOTE:$REMOTE_WWW/"
scp "$ROOT/website/app/index.html" "$REMOTE:$REMOTE_WWW/app/"
scp "$ROOT/website/assets/"*.png "$REMOTE:$REMOTE_WWW/assets/"
scp "$ROOT/website/.well-known/apple-app-site-association" "$REMOTE:$REMOTE_WWW/.well-known/"

echo "→ 更新 Caddy 配置（含 luge.chat / www.luge.chat）"
scp "$ROOT/website/Caddyfile" "$REMOTE:$REMOTE_CADDY/Caddyfile"

echo "→ 确保 Caddy 挂载 www 目录"
ssh "$REMOTE" 'grep -q "volumes/www/luge.chat:/srv/www" ~/supabase-project/docker-compose.caddy.yml || python3 - <<'"'"'PY'"'"'
from pathlib import Path
path = Path.home() / "supabase-project/docker-compose.caddy.yml"
text = path.read_text()
needle = "      - ./volumes/proxy/caddy:/etc/caddy\n"
insert = needle + "      - ./volumes/www/luge.chat:/srv/www:ro\n"
if insert not in text:
    text = text.replace(needle, insert, 1)
    path.write_text(text)
    print("added www volume mount")
else:
    print("www volume mount already present")
PY'

echo "→ 重建 Caddy"
ssh "$REMOTE" 'cd ~/supabase-project && docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --force-recreate caddy'

echo "✓ 部署完成：https://luge.chat · https://luge.chat/app/"
