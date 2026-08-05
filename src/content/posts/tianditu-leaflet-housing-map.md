---
title: 天地图 API + Leaflet：一个通勤选房的轻量级实践
published: 2026-08-05
description: 几十个候选小区，怎么筛出对两人通勤都友好的？用天地图 API 预计算通勤时间 + Leaflet 可视化，静态页面秒开、不暴露 API key。
tags: [地图, API, Leaflet, 前端]
category: 前端
draft: false
---

需求很实际：北京的一批保障房候选小区，怎么挑一个对**两个人的工作地通勤都友好**的？

方案：天地图 API 算通勤 + Leaflet 做地图可视化。全程预计算成静态 JSON，页面秒开、不暴露 API key。

## 架构：预计算，不实时调用

```
候选小区列表 → 地理编码(地址→经纬度) → 到双方工作地的路径规划(公交/驾车)
            → 通勤时间打分 → 排序 → 静态 JSON(预计算) → Leaflet 渲染
```

**关键设计：所有地图 API 调用在生成静态数据时一次性跑完**，页面只读预计算的 JSON 渲染，不做实时 API 调用。

好处：

- **省调用量**：几十个小区每个算 2 条路线，一次跑完
- **页面秒开**：没有等待 API 的延迟
- **不暴露 key**：key 只在生成脚本里，不进页面

## 天地图 API 三个接口

天地图 = 国家地理信息公共服务平台（`lbs.tianditu.gov.cn`）。

**1. 地理编码（地址 → 经纬度）**

```python
ds = json.dumps({"keyName": "北京市海淀区xxx"}, ensure_ascii=False)
url = "http://api.tianditu.gov.cn/geocoder?ds=" + urllib.parse.quote(ds) + "&tk=" + TK
# 返回 {"location": {"lon": 116.3, "lat": 39.9, ...}}
```

**2. 公交路径规划（参数坑最多）**

```python
ps = json.dumps({
    "startposition": f"{slon},{slat}",
    "endposition": f"{elon},{elat}",
    "linetype": "1"   # 1=较快捷 / 2=少换乘 / 4=少步行 / 8=不坐地铁
}, ensure_ascii=False)
url = "http://api.tianditu.gov.cn/transit?type=busline&postStr=" + urllib.parse.quote(ps) + "&tk=" + TK
# 注意：字段是全小写 startposition/endposition/linetype，不是 start/end
# 总时长 = results[].lines[].segments[].segmentLine[0].segmentTime 累加
```

**3. 驾车路径规划（字段名和公交不同，别混）**

```python
ps = json.dumps({"orig": f"{slon},{slat}", "dest": f"{elon},{elat}", "style": "0"}, ensure_ascii=False)
url = "http://api.tianditu.gov.cn/drive?type=drive&postStr=" + urllib.parse.quote(ps) + "&tk=" + TK
# 驾车用 orig/dest/style，公交用 startposition/endposition/linetype
```

## 三个实测的坑

**坑一：公交接口字段名全小写。** `startposition`/`endposition`/`linetype`，写成 `start`/`end` 直接报参数错误。每个接口的字段各不相同，别复用错。

**坑二：服务端 key 浏览器直调会被 WAF 拒。** 天地图检测到浏览器请求（UA 是浏览器 / 带 Referer）就拒绝；跨源还会被浏览器的跨域安全策略拦（`ERR_BLOCKED_BY_ORB`）。解法：**key 只放后端 / 代理**，服务端调完把结果给前端。

**坑三：底图瓦片也要同源反代。** 瓦片请求同样面临跨域问题，用 nginx 反代瓦片，伪装成非浏览器请求：

```nginx
location ~ ^/tdt/vec/(\d+)/(\d+)/(\d+)\.png$ {
    set $tk "你的KEY";
    proxy_pass http://<瓦片服务器>/vec_w/wmts?SERVICE=WMTS&...&tk=$tk;
    proxy_set_header User-Agent "curl/7.68.0";
    proxy_set_header Referer "";
    proxy_set_header Origin "";
}
# 前端直接用 L.tileLayer('/tdt/vec/{z}/{x}/{y}.png')
```

## 批量调用要限速 + 重试

几十个小区逐个算公交路线，批量调用必须**限速 + 超时重试**（本项目逐小区跑，超时重试 3 次 + 间隔）。别一把梭全发出去，会被限流。

## 可视化

Leaflet 画地图，圆形标记按通勤排名分级着色，点击显示通勤分钟 / 月租。纯前端，无框架，一个 HTML 文件搞定。

## 结论

这个项目最值得借鉴的**不是地图本身，是"预计算"这个设计**：

> **能提前算完的，就别让用户等；能在服务端算的，就别让浏览器碰。**

用一次性的预计算脚本把 API 调用全部跑完、结果落成静态 JSON，页面只做渲染——省调用、省延迟、保安全。很多"地图类"需求都适用这个套路。
