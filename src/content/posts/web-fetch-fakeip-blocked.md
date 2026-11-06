---
title: "fake-ip 模式下，为什么只有 Agent 的 web_fetch 被拦"
published: 2026-11-06
description: "DSH 的 web_fetch 报 non-public IP、curl 却一切正常的一次排障：从 fake-ip 白名单热载，到改校验函数本身"
tags: [Clash, mihomo, fake-ip, DSH, SSRF]
category: 运维
draft: false
---

## 一、问题是怎么长出来的

我本机常年开着 Clash Verge，mihomo 内核，TUN 加 fake-ip 模式。这天在 DeepSeek Harness（下称 DSH）里给它接记忆系统，顺手让 Agent 抓一篇官方文档，第一发就撞墙：

```
Error: URL hostname "docs.openviking.ai" resolves to a non-public IP address
```

换成 github.com，一样。但奇怪的是，同一台机器上 curl、node fetch 都好好的，连 Claude Code 里的 WebFetch 也不受影响。

先把三个组件各自在干什么摆清楚，雷就现形了：

- mihomo 的 DNS 把所有域名解析成 198.18.x.x 的假 IP（fake-ip 段），真实解析由代理侧完成
- TUN 把发往假 IP 的连接还原成域名，按规则走代理——这一层对普通 HTTP 客户端完全透明
- DSH 的 web_fetch 在发请求前多做了一步：自己解析一次域名，校验结果必须是公网单播地址，不是就直接拒绝。这是它的 SSRF 防护，防的是模型被人诱导去打内网

三个组件单看都没错。叠在一起：fake-ip 对"把域名直接交给 HTTP 栈"的客户端无害，对"自带 DNS 预检"的工具是毒药。198.18.0.0/15 是 RFC 2544 的 benchmark 保留段，ipaddr.js 一判，range 不是 unicast，拒绝。

一句话本质：**fake-ip 在连接层无害，只有自己动手做 DNS 校验的工具才会被它绊倒。**后面所有排查和修复，都是在跟这半句话较劲。

## 二、溯源：五段弯路和一次对照实验

### 先治标：fake-ip-filter 白名单

mihomo 的 fake-ip-filter 是黑名单语义——列表里的域名不做 fake-ip，返回真实解析。把目标域名加进去就行。麻烦在 Clash Verge Rev 的配置是三层合成的：`dns_config.yaml`（GUI 的 DNS 设置）→ `profiles\Merge.yaml`（全局合并）→ `clash-verge.yaml`（运行时产物）。要改就三处一起改，不然下次 GUI 重新合成就丢了。

改完，问题变成怎么让它立刻生效。

### 弯路一：管道名是旧的

mihomo 关了 TCP 的 external-controller，只开了 named pipe。我从配置文件里抄了管道名去连，ENOENT。后来才知道管道名是随会话生成的，配置里写的那份早过期了。正确姿势是现查：

```powershell
[System.IO.Directory]::GetFiles("\\.\pipe\") | Where-Object { $_ -match "verge|mihomo" }
```

查出来活管道叫 `verge-mihomo-production-<hash>`，配置里写的是 `sidecar-`。差一个词。

### 弯路二：204 骗了我一次

拿到活管道，`PUT /configs?force=true` 带空 path，返回 204。我以为成了。flush DNS 再解析，还是 198.18。

这时候有两个假设：fake-ip 有内存缓存，或者它压根没加载我改的文件。区分办法是查一个从没解析过的新子域——缓存解释不了新域名。结果新子域也是 fake-ip，实锤：**配置没生效**。空 path 重载的是"启动路径"的配置，不是我改的那份。

### 弯路三：400 的报错反而帮了忙

那就显式传 path。这回被 400 拒了，但报错信息是黄金：

```
path is not subpath of home directory or SAFE_PATHS
allowed paths: [C:\ProgramData\clash-verge-service\users\<hash>\runtime]
```

原来 service 模式下内核由提权服务启动，真正吃的配置在 ProgramData 下面那个 runtime 目录。我的 shell 非提权，写探测直接被拒。AppData 里那份 `clash-verge.yaml`，service 模式下只是个参考文件。

### 弯路四：清缓存端点不存在，杀进程也没杀掉

试 `DELETE /cache/fakeip`，404，这个内核版本没这端点。那就重启内核：`Stop-Process` 一发入魂，进程回来了，我以为是重启成功——核对 PID 才发现根本没变。提权服务下的进程，非提权的 Stop-Process 是被静默拒绝的，`-ErrorAction SilentlyContinue` 把拒绝吞了。教训：**验证进程重启，必须核 PID，不能只看"进程存在"**。

### 破局：payload 热载

mihomo 的 PUT /configs 还有个不落盘的模式——把整份 YAML 塞进 JSON 的 `payload` 字段直接内存加载，路径校验自然就绕开了。PowerShell 的 HTTP 栈不支持 named pipe，用 Node：

```js
const http = require('http'), fs = require('fs');
const cfg = fs.readFileSync('<clash-verge.yaml>', 'utf8');
const body = JSON.stringify({ payload: cfg });
const req = http.request({
  socketPath: '\\\\.\\pipe\\verge-mihomo-production-<hash>',
  method: 'PUT', path: '/configs?force=true',
  headers: { 'Content-Type': 'application/json',
             'Authorization': 'Bearer <secret>',
             'Content-Length': Buffer.byteLength(body) }
}, res => { let d = ''; res.on('data', c => d += c);
  res.on('end', () => console.log(res.statusCode, d || 'ok')); });
req.end(body);
```

204。这回真成了：目标域名解析出真实 IP（CNAME 指到 GitHub Pages 的 185.199.x.x），force 重载顺带把 DNS 模块重建，旧缓存一起清掉。web_fetch 直连 200。

### 对照实验：给"本质"上证据

白名单只救了固定几个域名。我想确认根因判断没跑偏，拿一个不在白名单的域名（stackoverflow.com，DNS 仍是 198.18.5.57）做了组对照：

| 客户端 | 结果 |
| --- | --- |
| DSH web_fetch | 拒绝，non-public IP |
| node fetch | HTTP 403（Cloudflare 反爬，连接层完全正常） |
| curl | HTTP 302（正常跳转） |

同一假 IP，预检工具死、普通客户端活。这也解释了 Claude Code 为什么从来不被挡——它的 WebFetch 没做这层 DNS 预检。

## 三、可照抄的药方

不想每个域名都去白名单里加一条，就得取消校验对 fake-ip 段的拦截。翻了 `@deepseek-ai/dsh-web-fetch-http` 的 README：配置面只有五个限流字段（maxResponseBytes 之类），公网校验没有开关，是硬编码。那就改代码，但只放行两个保留段，内网、环回、链路本地照拦——SSRF 防护的主体留着，fake-ip 段公网本来就不存在，放行没有代价。

### 改哪里

`node_modules\@deepseek-ai\dsh-web-fetch-http\lib\index.js` 的 `isPublicIpAddress()`，在 `parsed.range()` 判断前插两段：

```js
// IPv4 fake-ip: 198.18.0.0/15
if (parsed instanceof ipaddr.IPv4) {
  const o = parsed.octets;
  if (o[0] === 198 && (o[1] === 18 || o[1] === 19)) return true;
}
// IPv6 fake-ip: 2001:2::/48（mihomo 默认 fake-ip-range6 的母段）
if (parsed instanceof ipaddr.IPv6) {
  const p = parsed.parts;
  if (p[0] === 0x2001 && p[1] === 0x0002) return true;
}
```

两个坑，都踩过了：

- 这份 ipaddr.js 的 `match()` 不收字符串 CIDR，传 `"198.18.0.0/15"` 直接 `other.kind is not a function`。用 `octets` / `parts` 手判最稳
- DSH 的 `desktop-runtime.json` 给每个文件记了 `bytes` + `sha256` 完整性清单。改完代码必须同步这两项，否则可能过不了启动校验。用正则定位该文件的条目替换即可，改完 `ConvertFrom-Json` 验一下 JSON 没坏

单测结论（拿真实 ipaddr.js 跑的等价逻辑）：198.18.x / 198.19.x / 2001：2:: 全放行，8.8.8.8 等真实公网照旧放行，192.168.x、10.x、127.0.0.1、169.254.x、:：1、fe80:: 全部照旧拦截。

### 两个配套动作

- 重启 DSH 生效——运行中的进程还挂着旧模块
- 应用升级会重置 node_modules，patch 就没了。我留了个幂等脚本：检测到没有 patch 标记就重新打，重新算 hash 同步清单。升级后被挡了就重跑一次

### 验证

拿一个从没加过白名单的域名，重启前后各抓一次。DNS 侧保持 fake-ip 不变，web_fetch 从"non-public IP 拒绝"变成正常 HTTP 响应（403、302 都算通——那是目标站对代理出口的行为，连接层已经打通）。

最后留一条备忘：payload 热载是内存态，重启内核后就回到 ProgramData 里 service 的那份启动配置。好在持久层（dns_config.yaml、Merge.yaml）已经写好，Verge 自己触发的任何一次重新合成都会带上；GUI 的 DNS 设置页手动保存会重写 dns_config.yaml，改完记得确认 filter 条目还在。
