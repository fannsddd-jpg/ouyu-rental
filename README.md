# 偶域二房东管理系统 v3.0

适合二房东使用的房源管理 + 记账系统。部署在 Cloudflare Pages，点开链接就能用。

**已部署地址**: https://0bdc72be.ouyu-rental.pages.dev

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
- **数据库**：Cloudflare D1（通过 REST API 访问）
- **部署**：Cloudflare Pages

## 推送到 GitHub

```bash
# 1. 在 GitHub 创建新仓库 ouyu-rental（不要勾选 README）

# 2. 推送代码
cd 偶域项目目录
git remote add origin https://github.com/fannsddd-jpg/ouyu-rental.git
git branch -M main
git push -u origin main
```

## 创建永久 API Token

当前使用的是临时 OAuth Token（今天过期）。需要创建永久 Token：

1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 点击 **创建令牌** → **自定义令牌**
3. 权限设置：
   - 账户 / D1 / 编辑
4. 复制生成的 Token

更新 Secret：
```bash
npx wrangler pages secret put CF_API_TOKEN --project-name ouyu-rental
# 粘贴新的永久 Token
```

然后重新部署：
```bash
npx wrangler pages deploy .
```

## 本地开发

```bash
npm install
npm run dev
# 浏览器打开 http://localhost:8788
```

注意：本地开发时需要在 `.env` 文件中设置 `CF_API_TOKEN=你的token`。

## 数据安全

- 所有数据存储在 Cloudflare D1 数据库中
- 定期使用系统内"导出 JSON"功能下载本地备份
- Cloudflare D1 自带每日自动备份

## 项目结构

```
偶域/
├── index.html                  # 前端页面
├── app.js                      # 前端业务逻辑
├── functions/api/
│   └── [[route]].js            # 后端 API（Pages Functions）
├── db/schema.sql               # D1 数据库建表语句
├── assets/ouyu-avatar.png      # Logo
├── server.mjs                  # 原 Node.js 版（可本地运行）
├── wrangler.toml               # Cloudflare 配置
└── package.json
```
