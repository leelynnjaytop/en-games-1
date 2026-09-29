#!/usr/bin/env bash
# 线上冒烟检查：既确认新站点正常，也确认没影响原有站点
set -u
NEW="${1:-en1.lilinjie.top}"
OLD="${2:-tech.lilinjie.top}"
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  ✅ $1（$2）"; pass=$((pass+1)); else echo "  ❌ $1：期望 $3，实际 $2"; fail=$((fail+1)); fi; }

echo "── 原有站点未受影响 ──"
chk "https://$OLD 首页"      "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://$OLD/)" 200
chk "https://$OLD/html1"     "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://$OLD/html1)" 200

echo "── 新站点 ──"
chk "HTTP 自动跳 HTTPS"      "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 http://$NEW/)" 308
chk "HTTPS 大屏首页"          "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://$NEW/)" 200
chk "HTTPS 老师后台"          "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://$NEW/admin.html)" 200
chk "健康检查接口"            "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://$NEW/api/health)" 200
chk "后台写接口需登录"        "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X PUT -H 'Content-Type: application/json' -d '{}' https://$NEW/api/settings)" 401

echo "── 内容与证书 ──"
N=$(curl -s --max-time 15 https://$NEW/api/questions/meta | sed -n 's/.*"enabled":\([0-9]*\).*/\1/p')
chk "题库题数"                "${N:-0}" 60
CERT=$(echo | openssl s_client -connect "$NEW:443" -servername "$NEW" 2>/dev/null | openssl x509 -noout -issuer -dates 2>/dev/null)
[ -n "$CERT" ] && { echo "  ✅ HTTPS 证书："; echo "$CERT" | sed 's/^/     /'; pass=$((pass+1)); } || { echo "  ❌ 取不到证书"; fail=$((fail+1)); }

echo ""
echo "═══ 通过 $pass / 失败 $fail ═══"
exit $((fail>0))
