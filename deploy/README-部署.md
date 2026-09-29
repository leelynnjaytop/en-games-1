# 这台服务器上的部署方式

游戏以 **独立容器** 运行，挂在现有 `classhelper_default` docker 网络上，
**不占用任何主机端口**，也**没有修改 classHelper 的 docker-compose.yml**。
对外由现有的 Caddy 容器反代，域名 `en1.lilinjie.top`，HTTPS 由 Caddy 自动签发续期。

```
公网 :443 → classhelper-caddy-1 ──┬─ tech.lilinjie.top → classhelper-server:3000（原有）
                                  └─ en1.lilinjie.top  → en-games:3000（本项目）
```

| 项目 | 位置 |
|---|---|
| 代码 | `/home/ubuntu/en-games` |
| 数据库 | `/var/lib/en-games/data/app.db`（宿主机目录，容器挂载到 `/app/data`） |
| 镜像 | `en-games:1` |
| 容器 | `en-games`（`--restart unless-stopped`，开机自启） |
| Caddy 配置 | `/root/classHelper/Caddyfile` 末尾的 `en1.lilinjie.top` 块 |

## 常用运维命令

```bash
# 看日志
sudo docker logs -f en-games

# 重启
sudo docker restart en-games

# 更新代码后重新部署
cd /home/ubuntu/en-games          # 先把新代码 rsync 上来
sudo docker build -t en-games:1 .
sudo docker rm -f en-games
sudo docker run -d --name en-games --restart unless-stopped \
  --network classhelper_default \
  -v /var/lib/en-games/data:/app/data \
  -e ADMIN_PASSWORD='<你的后台口令>' \
  en-games:1

# 备份数据库 —— 必须用热备份，别直接 cp（WAL 模式下 cp 出来的是空壳）
sudo docker exec en-games npm run backup
# 备份落在宿主机 /var/lib/en-games/data/backup/ 下
sudo ls -lh /var/lib/en-games/data/backup/

# 改后台口令：改上面 -e ADMIN_PASSWORD 的值后重建容器即可
```

## 注意

- **Caddyfile 是和 classHelper 共用的**。改之前先备份：
  `sudo cp /root/classHelper/Caddyfile /root/classHelper/Caddyfile.bak-$(date +%F)`
  改完先校验再重载，别直接重启容器：
  `sudo docker exec classhelper-caddy-1 caddy validate --config /etc/caddy/Caddyfile`
  `sudo docker exec classhelper-caddy-1 caddy reload --config /etc/caddy/Caddyfile`
- **package-lock.json 必须用公共 registry 生成**。项目根目录的 `.npmrc` 已经把源固定成
  `registry.npmjs.org`，别删。如果在配了公司内网镜像（如 npm.shopee.io）的机器上重新生成
  lockfile，里面的下载地址会变成内网域名，服务器上解析不了，`npm ci` 会静默失败、
  装出一堆**空的依赖目录**，容器启动时报 `Cannot find module 'dotenv'`，
  而 npm 给出的错误却是很有迷惑性的 `Exit handler never called`。
  排查办法：`grep -o '"resolved": "https://[^/]*/' package-lock.json | sort -u`，
  应该只有 `https://registry.npmjs.org/` 一个。
