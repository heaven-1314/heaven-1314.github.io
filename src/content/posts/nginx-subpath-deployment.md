---
title: nginx 子路径部署的隐形炸弹：绝对路径怎么把页面变白屏
published: 2026-08-05
description: 应用部署到 nginx 子路径下页面全白，根因往往是应用内部用了绝对路径，被 nginx 的 catch-all 静默吞掉。200 但内容是错的，比 404 更隐蔽。
tags: [nginx, 部署, 子路径]
category: 运维
draft: false
---

一台服务器上跑多个应用，通常用 nginx 子路径区分：`/app-a/`、`/app-b/`、`/app-c/`。部署第三个应用时，页面全白——控制台里一堆静态资源 404，但**浏览器不报错**。

这种"页面白屏"是最难排查的一类，因为它是**静默失败**。

## 根因：绝对路径逃出子路径

SPA 应用（React、Next.js、Vue）内部常用**绝对路径**引用资源：

- 静态资源：`/_next/static/chunks/xxx.js`
- 后端 API：`/api/config`
- 页面路由：`/settings`

应用部署在 `/app-c/` 子路径下时，浏览器把这些绝对路径解析为：

```
http://host:port/_next/static/xxx.js     ← 没有前缀
http://host:port/api/config               ← 没有前缀
```

nginx 找不到对应的 location，请求落入 **catch-all `location /`**。如果 catch-all 恰好反代到另一个 SPA 应用，它会返回一个 200 的 HTML 壳（因为 SPA 对任意路径都返回首页）。浏览器拿到 HTML 但内容不是 JS 文件 → **白屏，且不报错**。

## 为什么 200 比 404 更坑

404 至少告诉你"路径不对"。这里的问题是：

- 请求 `/api/config` → 落 catch-all → 返回别的应用的 HTML → **200**
- 前端以为成功，实际拿到的是垃圾 → 业务静默失败

**200 但内容是错的，比 404 隐蔽十倍。** 排查时不要只看状态码，要看返回的 Content-Type 和实际内容。

## 子路径部署必配的三类路径

| 路径类型 | 例子 | 要不要配 |
|---------|------|---------|
| 页面路由 | `/app-c/settings` | ✅ proxy_pass 到前端端口 |
| 静态资源 | `/_next/static/` | ✅ 单独 location（SPA 框架的资源路径固定） |
| 后端 API | `/app-c/api/` | ✅ proxy_pass 到后端端口（不要 redirect，会丢请求体） |

框架静态资源路径速查：

- **Next.js**：`/_next/static/` 必须单独配 location
- **Vite**：`/assets/` 通常相对路径，但要检查
- **Create React App**：`/static/` 同理

## 部署前 5 分钟检查，避免 1 小时返工

```bash
# 1. 看 HTML 里引用了哪些路径
curl -s http://localhost:PORT/ | grep -oE '(src|href|action)="[^"]+"' | sort -u

# 2. 识别绝对路径（以 / 开头的）
#    /_next/... → 静态资源
#    /api/...   → API 调用
#    /xxx       → 页面路由

# 3. 每个绝对路径都要有 nginx location
#    静态资源 → proxy_pass 到前端端口
#    API 路径 → proxy_pass 到后端端口（保留请求体）
#    页面路径 → 带前缀反代

# 4. 一次性测试所有路径
curl -I http://domain:port/_next/static/chunks/xxx.js   # 静态资源
curl -X POST http://domain:port/api/config -d '{}'      # API（测请求体）
```

## 一次惨痛的失败教训

有一次部署因为没做上面的检查，一路边部署边修：页面白 → 配静态资源 → 链接 404 → 配页面路由 → API 失败 → 配 API → CORS 报错 → 加 CORS 头 → 前端硬编码 localhost → 改相对路径……

用户反复测试了 7 次，总共花了 1 小时 10 分钟，最终项目被放弃删除。**本该 10 分钟搞定的事。**

根因就是：**没在部署前一次性检查所有绝对路径**，而是让用户当测试员，一轮一轮发现问题。

正确流程：

```
读部署检查清单 → 部署前检查所有路径 → 本地测试所有路径 → 一次性配好 → 用户最终验证（1 次）
```

## 结论

子路径部署的铁律：

1. **部署前把 HTML 里所有绝对路径列出来**，为每个配 nginx location
2. **catch-all `location /` 是隐患**，能改成导航页就改
3. **用户只做最终验证，不做问题测试员**
4. 页面白屏先查**是不是 200 但内容错误**，别只盯 404

> **子路径部署的坑不在 nginx，在应用内部的绝对路径。先查路径，再查配置。**
