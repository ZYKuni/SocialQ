# 小区试点：配置和每周操作

代码里的小区试点功能在没配置数据库时是关闭的，网站保持原来的演示模式。按下面四步打开。

## 一、建数据库（Supabase，约 10 分钟）

1. 在 [supabase.com](https://supabase.com) 注册，新建一个项目。Region 选 **Southeast Asia (Singapore)**，套餐选 Free。数据库密码自己记好。
2. 左侧 **SQL Editor** → New query，把仓库里 `supabase/schema.sql` 的全部内容粘进去，点 Run。
3. 左下角 **Project Settings**，记下两样东西：
   - Project URL：`https://<Project ID>.supabase.co`，Project ID 在 General 页能看到
   - 密钥：**API Keys** 页里以 `sb_secret_` 开头的 secret key；只有旧版界面时用 Legacy 里的 `service_role`。它能读写全部数据，只放在 Vercel 和你自己电脑的 `.env.local` 里，不要发给别人。

## 二、在 Vercel 里配环境变量（约 5 分钟）

Vercel 项目 → 左侧栏 **Environment Variables**（旧版界面在 Settings 里），新增下面四个，Environment 勾选 Production 和 Preview：

| 名称 | 值 |
| --- | --- |
| `SUPABASE_URL` | 上一步的 Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 上一步的 service_role key |
| `COMMUNITY_CODE` | 小区口令，邻居注册时要输入 |
| `SESSION_SECRET` | 一串 32 位以上的随机字符，可以在终端运行 `openssl rand -base64 32` 生成 |

保存后到 **Deployments**，对最新一次部署点 Redeploy，环境变量才会生效。打开网站首页，看到“第一次来 / 已有账号”就说明开启成功了。

如果首页还是演示介绍，打开 `/api/community/me` 看一眼：`configured` 里哪一项是 `false`，就是那个变量没进到这次部署。最常见的原因是变量只勾了 Production 没勾 Preview（预览网址读的是 Preview），或者名字前后多了空格。改完要再 Redeploy 一次。

## 三、在自己电脑上准备开奖（约 5 分钟）

开奖脚本在你的电脑上跑，需要 Node 22 或更新版本。

```bash
cd SocialQ
git pull
npm install
```

在项目根目录的 `.env.local` 里加上（和 Vercel 里的值一样）：

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
LLM_API_KEY=你的 DeepSeek 密钥
```

## 四、每周三开奖

```bash
npm run round                       # 选配对、跑分身对话，生成“待审核”的一轮
npm run round -- --status=full      # 逐条看两个分身聊了什么
npm run round -- --reject=<配对 id>  # 去掉不合适的配对，可以多次
npm run round -- --publish          # 发布，邻居打开“本周配对”就能看到
```

发布后在邻居群里说一声“本周配对已出”。

- 默认每人最多 2 个配对，能配对的卡少于 10 张不开奖。可以用 `--per-user=3`、`--min=6` 调整。
- 以前配过的两个人、举报或拉黑过的两个人，不会再被配到一起。
- 想先看选人结果、不花大模型的钱：`npm run round -- --dry`。

## 看指标

在 Supabase 的 SQL Editor 里运行 `supabase/metrics.sql` 里的查询：建卡情况、每轮的双向想认识率、开奖回访人数、举报记录。也可以直接在 **Table Editor** 里看和改每张表。

## 需要注意

- Supabase 免费版一周没有任何访问会自动暂停，每周开奖本身就会访问，一般不会暂停。暂停了在控制台点 Restore 即可恢复。
- 免费版没有自动备份。建议每次开奖后在 Table Editor 里把 `users`、`cards`、`matches` 导出成 CSV 存一份。
- 你在后台能看到所有人的分身卡和分身对话，注册页已经告知了邻居。
- 邻居忘了密码：在 Table Editor 里删掉这个人的 `users` 行（会连带删除卡片和配对），让 TA 重新注册。

## 本地开发

`.env.local` 里写 `COMMUNITY_DEV_DB=1`，不连 Supabase，数据存在 `.data/dev-db.json`，小区口令是 `dev`。`npm run check:community` 跑逻辑自查。
