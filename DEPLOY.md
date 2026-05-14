# 培训机构学生管理系统部署指南

本文档说明如何在 Linux 服务器上使用 Node.js 20/22、systemd 和 Nginx 部署本项目。示例域名统一使用 `example.com`，实际部署时请替换为自己的域名。

## 1. 服务器准备

建议使用 Ubuntu 22.04/24.04 或 Debian 12。

```bash
sudo apt update
sudo apt install -y curl git nginx
```

安装 Node.js 20 或 22。下面以 NodeSource Node.js 22 为例：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

如果你的服务器已统一使用 Node.js 20，也可以安装 `setup_20.x`。

## 2. 创建运行用户和目录

应用不应以 root 用户运行。创建独立用户和目录：

```bash
sudo useradd --system --home /opt/training-school-student-management --shell /usr/sbin/nologin training-school
sudo mkdir -p /opt/training-school-student-management
sudo mkdir -p /var/lib/training-school-student-management
sudo mkdir -p /var/backups/training-school-student-management
sudo chown -R training-school:training-school /opt/training-school-student-management /var/lib/training-school-student-management /var/backups/training-school-student-management
```

## 3. 拉取代码并安装依赖

```bash
sudo -u training-school git clone <你的仓库地址> /opt/training-school-student-management
cd /opt/training-school-student-management
sudo -u training-school npm ci
sudo -u training-school npm run build
```

`npm run build` 会生成前端静态资源并执行项目检查。上线前应确保该命令成功完成。

## 4. 配置环境变量

复制 `.env.example` 的内容到 systemd 使用的环境文件：

```bash
sudo cp /opt/training-school-student-management/.env.example /etc/training-school-student-management.env
sudo chown root:training-school /etc/training-school-student-management.env
sudo chmod 640 /etc/training-school-student-management.env
sudo nano /etc/training-school-student-management.env
```

重点检查这些配置：

- `NODE_ENV=production`：生产环境标识。
- `PORT=4000`：Node 服务监听端口，需要和 Nginx 反代目标一致。当前学生管理系统使用 4000，避免占用老网站 3000 和 Gitea 3001。
- `DATA_FILE=/var/lib/training-school-student-management/data.json`：业务数据文件路径。
- `AUTH_ACCOUNTS=...`：登录账号 JSON 数组，上线前必须替换示例密码。
- `COOKIE_SECURE=true`：启用 HTTPS 后建议保持为 `true`。
- `SESSION_MAX_AGE_SECONDS=604800`：会话有效期，单位秒。

如果首次启动时数据文件不存在，应用会自动使用空数据初始化。请保证 `training-school` 用户对 `/var/lib/training-school-student-management` 有写入权限。

## 5. 配置 systemd

复制服务样例：

```bash
sudo cp /opt/training-school-student-management/deploy/training-school-student-management.service.example /etc/systemd/system/training-school-student-management.service
sudo systemctl daemon-reload
sudo systemctl enable training-school-student-management
sudo systemctl start training-school-student-management
```

查看运行状态和日志：

```bash
sudo systemctl status training-school-student-management
sudo journalctl -u training-school-student-management -f
```

本项目的服务入口是 `src/server.js`，systemd 样例会从 `/opt/training-school-student-management` 启动：

```ini
WorkingDirectory=/opt/training-school-student-management
EnvironmentFile=/etc/training-school-student-management.env
ExecStart=/usr/bin/node src/server.js
```

## 6. 配置 Nginx 反向代理

复制 Nginx 样例并替换域名和证书路径：

```bash
sudo cp /opt/training-school-student-management/deploy/nginx.conf.example /etc/nginx/sites-available/training-school-student-management
sudo nano /etc/nginx/sites-available/training-school-student-management
sudo ln -s /etc/nginx/sites-available/training-school-student-management /etc/nginx/sites-enabled/training-school-student-management
sudo nginx -t
sudo systemctl reload nginx
```

样例会把整站代理到 `http://127.0.0.1:4000`，并保留 `/health`、WebSocket 升级头和常用代理头。HTTPS 证书路径使用 `example.com` 占位，请替换为实际证书路径。

## 7. 健康检查

在服务器本机检查 Node 服务：

```bash
curl -i http://127.0.0.1:4000/health
```

通过 Nginx 检查外部访问：

```bash
curl -i https://example.com/health
```

预期返回 JSON：

```json
{"status":"ok"}
```

## 8. 数据备份

当前数据文件由 `DATA_FILE` 指定。建议至少每日备份：

```bash
sudo install -d -o training-school -g training-school /var/backups/training-school-student-management
sudo cp /var/lib/training-school-student-management/data.json /var/backups/training-school-student-management/data-$(date +%F-%H%M%S).json
```

应用每次保存数据时会先写入 `data.json.tmp`，成功后替换正式文件，并把替换前的正式文件保留为 `data.json.bak`。这个 `.bak` 只代表最近一次写入前的文件，不能替代长期备份。

恢复时先停止服务，再覆盖数据文件：

```bash
sudo systemctl stop training-school-student-management
sudo cp /var/backups/training-school-student-management/data-YYYY-MM-DD-HHMMSS.json /var/lib/training-school-student-management/data.json
sudo chown training-school:training-school /var/lib/training-school-student-management/data.json
sudo systemctl start training-school-student-management
```

恢复后建议立即检查：

```bash
sudo journalctl -u training-school-student-management -n 80 --no-pager
curl -i http://127.0.0.1:4000/health
```

## 9. 发布更新和回滚

更新到新版本：

```bash
cd /opt/training-school-student-management
sudo -u training-school git fetch --all
sudo -u training-school git checkout <目标分支或标签>
sudo -u training-school git pull --ff-only
sudo -u training-school npm ci
sudo -u training-school npm run build
sudo systemctl restart training-school-student-management
```

回滚到上一版本：

```bash
cd /opt/training-school-student-management
sudo -u training-school git checkout <上一个稳定提交或标签>
sudo -u training-school npm ci
sudo -u training-school npm run build
sudo systemctl restart training-school-student-management
```

如果回滚涉及数据变化，请先备份当前 `DATA_FILE`，再按需要恢复旧数据文件。

## 10. 上线验收清单

- `npm ci` 和 `npm run build` 已成功完成。
- `/etc/training-school-student-management.env` 已替换示例账号和密码。
- `AUTH_ACCOUNTS` 未保留 `admin123`、`teacher123`、`student123` 或 `change-me-*` 示例密码。
- `DATA_FILE` 所在目录归属为 `training-school:training-school`，服务用户可写。
- `systemctl status training-school-student-management` 显示服务正在运行。
- `curl http://127.0.0.1:4000/health` 返回 `{"status":"ok"}`。
- `nginx -t` 通过，Nginx 已 reload。
- `https://example.com/health` 返回 `{"status":"ok"}`。
- 浏览器可打开站点首页，并能完成登录、查看列表、新增记录等核心流程。
- 管理员可完成学生 CSV 导入预览、确认导入、导出 CSV；导出文件在表格软件中应正常显示中文。
- 已记录备份目录和回滚提交或标签。
