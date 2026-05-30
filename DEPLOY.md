# 偶域二房东管理系统 — Cloudflare 部署指南

## 一键部署（推荐）

### 1. 推送代码到 GitHub

```bash
cd 偶域项目目录
git init
git add .
git commit -m "偶域租房管理系统 v3.0"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create ouyu-db
```

复制输出的 `database_id`，更新 `wrangler.toml` 中的 `database_id` 字段。

### 3. 初始化数据库表

```bash
npx wrangler d1 execute ouyu-db --file=db/schema.sql
```

### 4. 部署到 Cloudflare Pages

**方法 A：命令行部署**
```bash
npx wrangler pages deploy .
```
然后按提示绑定 D1 数据库。

**方法 B：GitHub 自动部署（推荐，push 即部署）**
1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. 点击 **Create** → **Pages** → **Connect to Git**
3. 选择你的 GitHub 仓库
4. 构建设置：
   - Build command: 留空
   - Build output directory: `.`
5. 部署后，进入项目 **Settings** → **Functions** → **D1 database bindings**
6. 添加绑定：
   - Variable name: `DB`
   - D1 database: 选择 `ouyu-db`
7. 重新部署（Retry deploy）使绑定生效

### 5. 访问

部署完成后访问 Cloudflare 分配的域名，例如：
```
https://ouyu-rental-xxx.pages.dev
```

## 自定义域名

1. 在 Cloudflare Pages 项目 → **Custom domains** 中添加你的域名
2. Cloudflare 自动配置 DNS 和 SSL 证书

## 本地测试

```bash
npm install
npm run dev
# 浏览器打开 http://localhost:8788
```

## 常见问题

### 数据不显示？
- 确认 D1 数据库已绑定（Settings → Functions → D1 database bindings → DB → ouyu-db）
- 确认已运行 `db:init` 初始化表结构

### 部署后 404？
- 确认 Build output directory 设置为 `.`
- 确认项目根目录有 `index.html`

### 本地开发报错？
- 确认安装了 Node.js 18+
- 运行 `npm install` 安装 wrangler
