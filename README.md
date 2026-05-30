# 偶域二房东管理系统 v3.0

适合二房东使用的房源管理 + 记账系统。支持 Cloudflare Pages 一键部署，点开链接就能用。

## 功能

- **仪表盘**：总收入/支出/利润、年度现金流图表、风险提醒
- **房源管理**：房间信息、租客信息、租期管理、费用记录
- **记账系统**：收支记录、分类筛选、CSV 导出、分类占比图表
- **到期提醒**：自动识别 7 天内到期、30 天内到期、欠租和空置
- **数据备份**：JSON 导入导出、服务器自动备份
- **深色/浅色主题**：一键切换

## 技术栈

- **前端**：原生 HTML/CSS/JS + Chart.js
- **后端 API**：Cloudflare Pages Functions
- **数据库**：Cloudflare D1（SQLite 兼容）
- **部署**：Cloudflare Pages

## 本地开发

```bash
# 安装依赖
npm install

# 创建 D1 数据库（首次）
npx wrangler d1 create ouyu-db

# 将输出的 database_id 填入 wrangler.toml

# 初始化数据库表
npm run db:init

# 本地启动（前端 + API 一起）
npm run dev
```

浏览器打开 `http://localhost:8788` 即可使用。

## 部署到 Cloudflare

### 1. 推送到 GitHub

```bash
cd /Users/a1-6/Documents/偶域
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

把输出的 `database_id` 和 `database_name` 更新到 `wrangler.toml` 中。

### 3. 初始化数据库

```bash
npx wrangler d1 execute ouyu-db --file=db/schema.sql
```

### 4. 部署到 Cloudflare Pages

**方式一：命令行**
```bash
npm run deploy
```

**方式二：Cloudflare Dashboard**
1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. 选择你的 GitHub 仓库
4. Build settings:
   - **Build command**: 留空（不需要构建）
   - **Build output directory**: `.`
5. 在 **Settings** → **Functions** → **D1 database bindings** 中绑定 D1：
   - **Variable name**: `DB`
   - **D1 database**: 选择 `ouyu-db`
6. 点击 **Save and Deploy**

### 5. 获取链接

部署成功后，Cloudflare 会分配一个域名：
```
https://ouyu-rental.pages.dev
```

也可以在 Cloudflare Dashboard 绑定自定义域名。

## 无需密码

v3.0 起改为个人使用模式，无需登录密码。如需多人共享使用，建议配合 Cloudflare Access 或 Zero Trust 添加访问控制。

## 数据安全

- 所有数据存储在 Cloudflare D1 数据库中
- 定期使用系统内"导出 JSON"功能下载备份
- Cloudflare D1 自带每日自动备份

## 项目结构

```
偶域/
├── index.html              # 前端页面
├── app.js                  # 前端业务逻辑
├── functions/
│   └── api/
│       └── [[route]].js    # 后端 API（Cloudflare Pages Functions）
├── db/
│   └── schema.sql          # D1 数据库建表语句
├── assets/
│   └── ouyu-avatar.png     # Logo
├── wrangler.toml           # Cloudflare 配置
├── package.json            # 项目配置
└── README.md               # 本文件
```
