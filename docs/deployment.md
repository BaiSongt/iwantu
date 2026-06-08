# iWantU 部署指南

> 本文档介绍如何在 VPS 上部署 iWantU 平台的完整流程。

---

## 服务器要求

### 最低配置

| 项目 | 要求 |
|------|------|
| **CPU** | 2 核 |
| **内存** | 2 GB RAM |
| **磁盘** | 20 GB SSD |
| **系统** | Ubuntu 22.04 LTS |
| **网络** | 公网 IP，开放 80 / 443 端口 |

### 推荐配置

| 项目 | 要求 |
|------|------|
| **CPU** | 4 核 |
| **内存** | 4 GB RAM |
| **磁盘** | 40 GB SSD |
| **系统** | Ubuntu 22.04 LTS |

---

## 1. Docker 安装

### 卸载旧版本

```bash
sudo apt-get remove -y docker docker-engine docker.io containerd runc
```

### 安装 Docker

```bash
# 更新包索引
sudo apt-get update

# 安装依赖
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# 添加 Docker GPG 密钥
sudo mkdir -m 0755 -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 添加 Docker 仓库
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 启动 Docker
sudo systemctl start docker
sudo systemctl enable docker

# 将当前用户加入 docker 组（免 sudo）
sudo usermod -aG docker $USER
newgrp docker

# 验证安装
docker --version
docker compose version
```

---

## 2. 克隆项目与配置

### 克隆代码

```bash
cd /opt
sudo git clone <repository-url> iwantu
sudo chown -R $USER:$USER /opt/iwantu
cd /opt/iwantu
```

### 配置环境变量

```bash
cp .env.example .env
nano .env
```

编辑 `.env` 文件，填入实际值：

```env
# PostgreSQL
DATABASE_URL=postgresql://iwantu:<强密码>@postgres:5432/iwantu

# JWT 密钥（务必使用随机生成的强密钥）
JWT_SECRET=$(openssl rand -base64 32)

# SMTP（注册验证码功能依赖此项，必须配置）
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=<smtp-password>
EMAIL_FROM="iWantU <noreply@yourdomain.com>"

# 环境
NODE_ENV=production

# 上传目录
UPLOAD_DIR=/data/uploads
```

生成安全密钥：

```bash
# 生成 JWT 密钥
openssl rand -base64 32

# 生成 PostgreSQL 密码
openssl rand -base64 16
```

---

## 3. Docker Compose 生产配置

确认 `docker-compose.yml` 中的配置正确。默认配置如下：

- `app` 服务从本地源码构建（`./next-app/Dockerfile`），构建后的镜像标记为 `iwantu-app:latest`
- PostgreSQL 数据持久化到 Docker Volume
- Next.js 应用多阶段构建
- 健康检查确保服务可用

启动服务（从本地源码构建并启动，无需远程镜像）：

```bash
cd /opt/iwantu

# 构建并启动（首次部署或代码更新后）
docker compose up -d --build

# 查看服务状态
docker compose ps

# 查看应用日志
docker compose logs -f app

# 查看 PostgreSQL 日志
docker compose logs -f postgres
```

---

## 4. 注册验证码（SMTP 配置）

注册流程使用邮箱验证码确认用户身份。**此功能依赖 SMTP 配置，部署时必须正确设置以下环境变量：**

| 变量 | 说明 |
|------|------|
| `SMTP_HOST` | SMTP 服务器地址（如 `smtp.qq.com`、`smtp.gmail.com`） |
| `SMTP_PORT` | SMTP 端口（通常 `587` 为 STARTTLS，`465` 为 SSL） |
| `SMTP_USER` | SMTP 登录用户名 |
| `SMTP_PASS` | SMTP 登录密码或授权码 |
| `EMAIL_FROM` | 发件人地址，格式 `"iWantU <noreply@your-domain.com>"` |

验证码特性：

- 6 位随机数字，10 分钟内有效
- 每个验证码最多尝试 5 次
- 同一邮箱 60 秒内只能发送一次
- 验证码以 HMAC-SHA256 哈希存储，不明文入库

---

## 5. 数据库初始化

### 首次部署

```bash
# 进入应用容器执行迁移
docker compose exec app npx prisma migrate deploy

# 填充种子数据
docker compose exec app npm run db:seed
```

### 后续更新

每次代码更新后，如果 Prisma Schema 有变更，需要执行迁移：

```bash
docker compose exec app npx prisma migrate deploy
```

---

## 6. SSL 证书配置 (Let's Encrypt)

### 安装 Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

### 获取证书

将 `yourdomain.com` 替换为实际域名：

```bash
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com
```

证书文件位于：
- 证书：`/etc/letsencrypt/live/yourdomain.com/fullchain.pem`
- 私钥：`/etc/letsencrypt/live/yourdomain.com/privkey.pem`

### 自动续期

Certbot 会自动配置定时任务，验证：

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

---

## 7. Nginx 配置

### 安装 Nginx

```bash
sudo apt-get install -y nginx
```

### 创建配置文件

```bash
sudo nano /etc/nginx/sites-available/iwantu
```

填入以下内容（替换 `yourdomain.com`）：

```nginx
# HTTP -> HTTPS 重定向
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Certbot 验证
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 代理到 Next.js 应用
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 上传文件大小限制
    client_max_body_size 50M;

    # 静态资源缓存
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # Gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
    gzip_min_length 1000;
}
```

### 启用站点

```bash
sudo ln -s /etc/nginx/sites-available/iwantu /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 检查配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
sudo systemctl enable nginx
```

---

## 8. 备份策略

### 数据库备份脚本

创建备份脚本：

```bash
sudo mkdir -p /opt/backups
sudo nano /opt/backups/backup.sh
```

```bash
#!/bin/bash
set -euo pipefail

# 配置
BACKUP_DIR="/opt/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/iwantu_db_$TIMESTAMP.sql.gz"
RETAIN_DAYS=30

# 通过 Docker 执行 pg_dump
docker compose -f /opt/iwantu/docker-compose.yml exec -T postgres \
  pg_dump -U iwantu iwantu | gzip > "$BACKUP_FILE"

echo "[$(date)] 备份完成: $BACKUP_FILE"

# 清理旧备份
find "$BACKUP_DIR" -name "iwantu_db_*.sql.gz" -mtime +$RETAIN_DAYS -delete
echo "[$(date)] 已清理 $RETAIN_DAYS 天前的旧备份"
```

### 设置定时任务

```bash
chmod +x /opt/backups/backup.sh

# 每天凌晨 3 点自动备份
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/backups/backup.sh >> /opt/backups/backup.log 2>&1") | crontab -
```

### 恢复数据库

```bash
# 解压并恢复
gunzip -c /opt/backups/iwantu_db_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose -f /opt/iwantu/docker-compose.yml exec -T postgres \
  psql -U iwantu iwantu
```

---

## 9. 监控设置

### 健康检查

平台提供 `/api/health` 健康检查端点，可用于监控：

```bash
# 手动检查
curl -s http://localhost:3000/api/health

# 配置 cron 定时检查
(crontab -l 2>/dev/null; echo "*/5 * * * * curl -sf http://localhost:3000/api/health > /dev/null || echo 'iWantU health check failed at $(date)' >> /var/log/iwantu-health.log") | crontab -
```

### 日志管理

```bash
# 查看应用日志
docker compose -f /opt/iwantu/docker-compose.yml logs --tail=100 -f app

# 查看 PostgreSQL 日志
docker compose -f /opt/iwantu/docker-compose.yml logs --tail=100 -f postgres

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 磁盘空间监控

```bash
# 检查磁盘使用
df -h

# 检查 Docker 磁盘使用
docker system df

# 清理 Docker 资源
docker system prune -a --volumes
```

---

## 10. 更新流程

### 代码更新

```bash
cd /opt/iwantu

# 1. 拉取最新代码
git pull origin master

# 2. 备份数据库
/opt/backups/backup.sh

# 3. 重新构建并启动
docker compose up -d --build

# 4. 执行数据库迁移（如有变更）
docker compose exec app npx prisma migrate deploy

# 5. 验证服务
curl -s http://localhost:3000/api/health
```

### 回滚

```bash
cd /opt/iwantu

# 1. 回退代码
git checkout <previous-commit-hash>

# 2. 重新构建
docker compose up -d --build

# 3. 如需恢复数据库
gunzip -c /opt/backups/iwantu_db_<timestamp>.sql.gz | \
  docker compose exec -T postgres psql -U iwantu iwantu
```

---

## 11. 安全建议

### 防火墙配置

```bash
# 安装 UFW
sudo apt-get install -y ufw

# 默认拒绝入站
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 开放必要端口
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS

# 启用防火墙
sudo ufw enable
sudo ufw status
```

### SSH 安全加固

```bash
sudo nano /etc/ssh/sshd_config

# 禁用密码登录（建议使用密钥登录）
# PasswordAuthentication no
# PubkeyAuthentication yes
```

### 定期更新系统

```bash
sudo apt-get update && sudo apt-get upgrade -y
```
