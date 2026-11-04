---
title: "瑞数6反爬实战：从 412 拦截到虚拟屏幕会话借道"
published: 2026-11-02
description: "政务公文定向采集遇到瑞数6代 412 拦截，通过 xvfb 虚拟屏幕+有头拟真浏览器过环境指纹，借道真实会话取数。"
tags: [反爬, Playwright, 瑞数, 政务采集, 爬虫]
category: 工程实践
draft: false
---

## 问题是怎么产生的

我在做一个政务网站公文定向采集工具，站点按难度分级调度：普通站直接协议请求，难点站走浏览器攻坚。上线实测 18 个样本站，有三站稳定返回 412，页面标题和正文全拿不到。

第一眼看这个状态码就很怪。反爬拦截通常用 403，瑞数用的是 412 Precondition Failed，语义是「你缺一个前置条件」。响应体也不是普通错误页，是一大段高度混淆的 JavaScript，特征非常明显：

- 对象名 `$_ts`，字段包括 `cd` 执行标志、`scj` 虚拟机上下文、`aebi` 环境采集数组
- `while(1)` 里的字节码分发，取指令再按数值区间跳转，这是典型的自定义虚拟机
- 函数名全是 `_$fW`、`_$ej`、`_$gp` 这种无意义的混淆标识符

定性明确，这是瑞数 6 代动态反爬，核心逻辑是：服务端通过 412 下发一段种子脚本，浏览器必须把这段 JS 跑完、算出一个合法 cookie，才能拿到真实页面。

## 溯源推理

### 为什么 headless 跑不过

我的第一版攻坚脚本就是 Playwright 启动 Chrome，headless=True 去访问，结果如下：

- 过盾判定（混淆标签消失）通过了
- cookie 好像也算出来了
- 但访问真实页面时，数据是空的

这时候我开始怀疑环境指纹。测试发现瑞数在算出 cookie 之前，会采集一整套环境特征：

| 指纹点 | 探测频率 | 它在防什么 |
|---|---|---|
| navigator.webdriver | 多次 getOwnPropertyDescriptor | Selenium/Playwright 自动化标志 |
| Function 构造器 | 290 次触碰 | 补环境脚本最容易露馅的地方 |
| canvas + fillText + toDataURL | 多次 | canvas 像素指纹 |
| webgl | 多次 | WebGL 渲染器指纹 |
| setInterval / setTimeout | 234 / 69 次 | headless 时间行为异常 |
| screen | 2 次 | 屏幕分辨率 |

`navigator.webdriver` 探测得尤其刁钻，它不直接读值，而是用 `Object.getOwnPropertyDescriptor` 分别在实例和原型上查一遍。实例上没有，原型上必须是原生 getter。headless 模式会暴露自动化标志，算出的 cookie 是废的。

结论很直白：瑞数防的不是真浏览器，而是伪装成浏览器的脚本。给它一个真正的浏览器环境，它反而愿意自己把门打开。

### 服务器上没有显示器，怎么给真浏览器

当时环境是 Linux 无头服务器，没有 X Server。有两个方向：

1. 装一个虚拟显示服务 xvfb，让 Chrome 认为有真实显示器，以此跑有头模式
2. 继续 headless，但强行补环境指纹

我选了 1。理由很直接，硬刚指纹是另一个工期的事，虚拟屏幕五分钟就能搭好，而且指纹永远是真实 Chrome 完整暴露。

### 关键一步：屏幕外坐标渲染

有头模式跑起来，如果弹出窗口，显然不合适。解法是 `--window-position=-2000,-2000`，把真窗口丢到屏幕坐标外。窗口真实存在，指纹对得上，但不打扰人。

配合 `--disable-blink-features=AutomationControlled` 关掉 Blink 自动化标志，再对齐语言和时区：

```python
from playwright.sync_api import sync_playwright

browser = p.chromium.launch(
    executable_path="/usr/local/bin/google-chrome",
    headless=False,
    args=[
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--window-position=-2000,-2000",
        "--window-size=1920,1080",
    ],
)
ctx = browser.new_context(
    viewport={"width": 1920, "height": 1080},
    locale="zh-CN",
    timezone_id="Asia/Shanghai",
)
```

实践里用系统 Chrome 的可执行文件，而不是 Playwright 自带的 Chromium，自带那个自动化特征更强。

### 过盾判定不能写早

第一版我用「混淆页标记消失」当成功条件。这个条件本身没错，412 混淆页带 `<meta r='m'>`，真实页没有。但标记消失只代表第一步 JS 跑完，业务层还会继续写 session cookie。判定过了立刻抓数据，抓到的是半成品。

正确节奏是：

```python
page.wait_for_function("() => !document.querySelector(\"meta[r='m']\")", timeout=30000)
page.wait_for_timeout(5000)  # 等业务 JS 把附加 cookie 写全
```

### 双 cookie 机制

顺着链路把 cookie 下发逻辑摸清了：

- 服务端 412 响应下发 `O` 种子 cookie（HttpOnly，单段 base64），这是「题目」
- 浏览器执行混淆 JS 后，客户端计算生成 `P` cookie（document.cookie，四段以点分隔），这是「答案」
- 两者配对服务端校验，缺一不可

名字每次会话随机，但结构固定。所以绝不挑其中某个 cookie 单独复用，必须整包带上。

### 列表数据其实在 SPA 接口里

页面过了盾，我拿到了第一页 HTML，却发现列表容器是空的。去抓前端 JS，发现这个站的搜索是单页应用，真正的数据在一个 JSON 接口里，翻页只是改 URL 上的页码参数。

这一步直接改变了方案，不再解析每页 HTML，而是带着会话 cookie 直接打这个接口，循环翻页。

## 解决方案：可照抄的药方

完整流程分四步：

### 1. 虚拟屏幕启动有头 Chrome

```bash
xvfb-run -a python3 crawl.py
```

### 2. 打开首页，等待过盾

```python
page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
page.wait_for_function("() => !document.querySelector(\"meta[r='m']\")", timeout=30000)
page.wait_for_timeout(5000)
```

### 3. 借道会话，直接打搜索接口

```python
resp = ctx.request.get(search_url, headers={
    "Referer": BASE_URL,
    "X-Requested-With": "XMLHttpRequest",
})
```

`ctx.request` 自动携带会话里的全部 cookie，包括瑞数的 O/P 和业务层 session，一个不漏。

### 4. 循环翻页

```python
all_items = []
page_num = 1
while True:
    items = parse_page(resp.json())
    all_items.extend(items)
    if page_num * PAGE_SIZE >= int(total):
        break
    page_num += 1
```

翻页终止条件用 `page * pageSize >= total`，同时保留「results 为空即停」兜底，防止接口被风控截断时死循环。

### 实测结果

三站全部从 412 拦截转为正常采集，共命中 24 篇相关公文，标题、链接、日期全字段无缺。整个过程没有还原瑞数虚拟机，只是给了它一个真正的浏览器环境。

## 过盾之后：同一套拟真还能做更多

问题打穿不是终点。工具上线运营后，同一个采集链路走出了三个新变化，都是在「真浏览器会话」这个地基上长出来的。

### 兜底抓正文：拟真浏览器直接复用

采集链路有一个副产品：历史任务的存量文章，大多是早期「列表页信息 + 摘要」的记录，没有存正文。后来需求升级，导出的 Word 要带完整正文，就得按需补抓。

第一版补抓是纯协议直连，普通政务站效果很好，但**重反爬站全军覆没**——正文抓取失败率接近百分之百，理由和当初 412 拦截一模一样：协议请求过不了环境指纹这一关。

解法很省事：不新造轮子，把当初 `xvfb + 真 Chrome 拟真` 这套原样下沉，改成一个「逐页取 HTML」的子进程（复用同一批启动参数、同款指纹对齐、同站点复用 Context 保住 Cookie），批量任务库里剩下的重反爬站。直连未过、且又不属于重反爬的普通站，仍然走快速直连，两条轨各司其职。

实测一个 67 篇的历史全量导出：65 篇拿到完整正文，重反爬站群全部通过，2 篇失败是另一类数据问题，见下文。

### 踩坑：列表页会把配图误收成「文章」

全量回归时那 2 篇失败的正文，追查后抽了一个奇怪的根因——它们的「原文链接」根本不是什么文章页，是一张 `.png` 图片直链。个别站的栏目列表里，标题链接指到了配图资源，采集端照单全收，导出去抓正文时自然一无所获，还会在文档里打上误导性的「抓取失败」降级标注。

修复改在源头：列表解析阶段过滤掉图片/附件后缀的链接（`png/jpg/gif/webp/svg/ico` 等），文章列表从此不会再混入资源直链。改完用单测覆盖这个规则，过滤生效、真链接保留。

### 批量导出的交付形态：别把多篇塞进一个文档

批量导出 Word 时，最偷懒的做法是把所有文章顺序堆进同一个文档，前面再挂个标题列表，就当完事。但成品很快会变成「标题 + 链接 + 全文」的流水账：

- 单篇动辄几十页，定位一篇靠滚动，阅读和分发都很痛苦
- 想让不同的人各拿几篇，只能整包转，无法按需拆
- 更致命的是没有披露机制：哪几篇正文完整、哪几篇降级，用户从成品上看不出来，出了问题也无从查起

更干净的交付形态是「每篇独立文档 + 打包」。文章逐篇生成独立的 .docx，文件名带序号与标题，统一打进一个 ZIP；另附一份说明清单，明确记录总数、正文完整篇数、实时抓取篇数、降级篇数与原因。用户拿到包就能按篇分发，每一篇的状态一目了然。只选单篇时，直接下发单个文档即可，无需打包。

批量导出还有一个容易被忽略的反模式——**静默截断**。有些实现会给导出数量设一个硬上限，超出后不声不响只导出前 N 篇。用户拿到手发现篇数不对，第一反应是「抓取失败」或「丢数据」，排查成本极高，实际上只是上限被悄悄触发。正确姿势是：上限只作为保护阈值，一旦超限必须显式报错，绝不能留下「导出一半」的错觉。

## 复盘

回头看，真正的转折点是放下「还原算法」的执念：

- 从「逆向混淆 JS」转向「借道真浏览器会话」
- 从「解析 HTML」转向「打 SPA JSON 接口」
- 从「抠两个 cookie」转向「复用整个会话」

逆向最省力的姿势，是让真环境把难的那步跑完，你只做后面能做的。别跟一台混淆虚拟机死磕，先问一句，有没有更靠外的口子。
