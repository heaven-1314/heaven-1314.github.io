---
title: "一份342页PDF转Word的活，逼我把6.3GB大模型塞进了8GB笔记本"
published: 2026-08-06
description: "百度Unlimited-OCR本地部署全纪录:8GB显存、Blackwell无声失败、Windows反超WSL2、大PDF逐页架构——两天踩坑记。"
tags: [大模型部署, OCR, 本地推理, 显存优化, Unlimited-OCR]
category: 工程实践
draft: false
---

事情的起点很朴素:有人递给我一份 **342 页的招标 PDF**,要转成 Word。

第一步绕不开 OCR。但这份文件里全是表格、多栏、图文混排,还有跨页的章节——传统逐页切图的 OCR 一上,版面碎成渣,语境全丢。云 OCR 呢,342 页要钱,而且招标内容含商务条款,不适合往云上传。

我盯上了百度刚开源的 **Unlimited-OCR**。它不是飞桨 PaddleOCR 那条传统检测+识别的线,而是一个 3B MoE 的**视觉语言大模型**(VLM),6.3GB,官方标语很狂:"**One-shot Long-horizon Parsing**"——一次性长文档解析,无限上下文,整篇文档一起理解。

听起来正合适。但问题是:我这台笔记本是 **RTX 5060 Laptop,只有 8GB 显存**。6.3GB 的模型塞进 8GB 的卡,听起来就像把一头大象塞进冰箱。

后来的两天,就是在反复验证"到底塞不塞得进去"。这篇文章记的就是这个过程。

## 选型:为什么是 VLM 路线

OCR 方案我大致分三类:

- **传统 OCR(PaddleOCR、Tesseract)**:检测+识别管线,快、轻,但跨页语境丢光——表格被分页切断、标题和正文分家、图文混排还原差。
- **云端 OCR**:效果好,但贵 + 招标内容不宜外传。
- **VLM 大模型 OCR(Unlimited-OCR、DeepSeek-OCR、MinerU)**:整页当图像喂给大模型,它自己理解版面、保持上下文,对复杂版式还原最强。

Unlimited-OCR 的卖点正好打在痛点上:无限上下文、VLM 理解版面、开源可本地。零成本、完全可控,代价是得和 8GB 显存死磕。

**先说清楚一件事**:本次是**部署 + 推理工程优化**,不是微调。没改一行模型权重,纯粹是把官方模型在消费级硬件上跑稳、跑快、跑通批量。这两件事千万别混。

## 第一关:环境,一堆无声的坑

### 下载源——别盲目走代理

2.5GB 的 torch wheel,我一开始用阿里云镜像,下了 20 分钟才三分之一。后来换交大镜像(mirror.sjtu.edu.cn),**1 分钟搞定**,42MB/s。

更坑的是官方 CDN(download.pytorch.org)走 Clash 代理必报 SSL EOF——TLS 指纹问题。清华 TUNA 当时只有不到 5KB/s。

**教训:大文件下载先 curl 测 6 秒速,再选源。国内直连镜像常比走代理快得多。**

| 源 | 速度 | 备注 |
|---|---|---|
| 官方 CDN 走 Clash | SSL EOF | TLS 指纹问题 |
| mirrors.aliyun.com | 1.5 MB/s | 慢 |
| **mirror.sjtu.edu.cn** | **42 MB/s** | torch wheel 首选 |
| **hf-mirror.com** | **61 MB/s** | HuggingFace 模型首选 |

### Blackwell 显卡必须用 cu128

RTX 5060 是 50 系,compute capability 是 **sm_120(Blackwell)**。我装了 torch cu126,`torch.cuda.is_available()` 返回 `True`,以为成了。结果一跑推理,报 "not compatible"。

这是最阴的一类坑——**它不直接报错,而是装的时候正常、用的时候无声失败**。cu126 构建只支持到 sm_90,50 系是 sm_120,对不上。cu129 又没有 Windows 构建,只有 **cu128** 有。

**教训:装 torch 前先 `torch.cuda.get_device_capability()` 确认 GPU 算力,选对应 CUDA 版本。50 系必上 cu128。**

### Windows 上的段错误

模型用了 `trust_remote_code`,我照惯例加了 `low_cpu_mem_usage=True` 想省内存。结果 `from_pretrained` 时直接 **Segmentation fault**(段错误)崩溃。

诡异的是纯 `import` 没事,一到加载就崩。排查走了弯路。最后发现:**去掉这个参数就正常了**。

trust_remote_code 模型在 Windows 上慎用 `low_cpu_mem_usage`,有段错误风险。这是个没法预报、只能靠踩的坑。

## 第二关:"无限上下文"的真相

这是最核心的一个坑,也是我觉得最值得写的一坑。

Unlimited-OCR 不是号称"无限上下文、一次性长文档解析"吗?那我第一反应是:342 页一股脑塞给它,`model.infer_multi()` 一次搞定,多爽。

结果**全废**。342 页长文档,token 截断、OOM,什么都跑不出来。

翻官方架构才发现:**它自己也是 PyMuPDF 拆页 → 逐页单独 `infer()` → 流式聚合**。

这里有个反讽,必须说清楚:

> 官方标语"无限上下文 One-shot 长文档解析"是**模型能力层面**的——单页内能理解任意长内容、不截断。但工程上跑 342 页 PDF,**仍然必须逐页拆分喂**,否则显存和 token 都顶不住。

**"模型能力" ≠ "工程实现"。** 标语说的是模型单次推理内不截断,不代表你能把整本 PDF 一次塞进推理函数。分不清这个,架构就会判错。

正确做法:`infer_multi()` 是给"几张图一起识别"用的,不是给"几百页文档一起理解"用的。大 PDF 必须逐页推理,靠前端聚合结果。这是架构红线。

## 第三关:8GB 显存,怎么塞 6.3GB 模型

这是整件事最反直觉的部分。

起初我太保守,设 `max_memory={0:"4.8GiB"}`,把三分之一层 offload 到 CPU。结果 PCIe 来回搬数据,GPU 利用率一直上不去,我当时还以为是"batch=1 的天花板"——这是个刻板印象,很多人会这么归因。

后来放宽到 `{0:"6.8GiB"}`,打印 `model.hf_device_map` 的 Counter一看,**所有层都在 cuda 上了**(`{'0': 1}`),GPU 利用率直接拉到 **99%**。

超额的部分怎么办?靠 **Windows 共享 GPU 内存**自动兜底。这是 8GB 卡能跑起来的关键。

**诊断方法**:加载后打印 `model.hf_device_map` 的 Counter,看层在 cuda vs cpu 的分布。GPU 利用率低,第一件事不是怀疑 batch,是确认层分布。

## 反直觉高潮:Windows 原生居然赢了 WSL2

我想更快,试了 WSL2 + SGLang(一个推理框架)。结果这条路彻底走不通,而且原因很反直觉:

- WSL2 GPU 直通只有 **6.84GB** 可用(CUDA context 占了点)
- 模型加载完(6.49GB)只剩 0.28GB,**SGLang 的 KV cache 池无处安放**
- 关键:**WSL2 用不了 Windows 的共享 GPU 内存兜底**——这是它和 Windows 原生 WDDM 架构的根本差异

也就是说,在 Windows 原生下,8GB 是"8GB + 共享内存兜底";在 WSL2 下,8GB 是**硬墙**。

**结论:8GB 卡只能 Windows 原生 Transformers;SGLang 至少要 12GB 显存才有意义。**

很多人下意识觉得"Linux/WSL2 跑 AI 更专业",在小显存这个场景里,这个直觉是错的。

## 最终架构

抛弃了 Gradio(版本冲突太烦),换 **FastAPI + SSE + 自定义前端**,更可控:

```
C:\Users\Legion\Unlimited-OCR\
├── run_web.bat          Web 服务启动(双击)
├── app.py               FastAPI 后端(推理 + SSE 流式)
├── index.html           深色双栏前端(复刻官方 UI)
├── run_ocr.bat          单图命令行(拖拽即用)
├── test_infer.py        命令行推理入口
├── models/Unlimited-OCR/  权重 + 5 个 trust_remote_code .py
└── .venv/               torch 2.10+cu128 + transformers 4.57.1
```

几个关键优化:

1. **stdout 劫持实现 token 级流式**:复刻官方 `ThreadTargetedStdout`,劫持推理线程的 stdout,逐 token 推到前端 SSE,边识别边出字。
2. **`save_results=False`**:去掉每页用 matplotlib 画带框图的开销(前端用不到),GPU 不用空等。
3. **双层文本清理**:模型原始输出是 `<|det|>title [46,81,521,134]<|/det|>实际文本` 这种带检测框坐标的——流式时用 `clean_stream` 缓冲隐藏未闭合标记,整页完成后用官方 `remove_det` 规整。

实测结果:33MB / 342 页招标文件,**逐页流式解析成功,中文识别精准,GPU 利用率 ~99%**。

## 一些可以复用的认知

踩完这堆坑,我总结了下面这些,下次本地部署大模型应该能少走弯路:

1. **8GB 显存是大模型本地部署的生死线**,6.3GB 刚好挤进去,再大就难。
2. **Windows 共享 GPU 内存是 8GB 卡的救命稻草**,WSL2 没有这个机制——所以小显存反而 Windows 原生更合适。
3. **GPU 利用率低,先排查 offload**,别急着甩锅给 batch=1。先看 `hf_device_map` 层分布是不是全在 GPU。
4. **大 PDF 必须逐页处理**,即便模型号称"无限上下文"——那是模型能力,不是工程实现。
5. **trust_remote_code 模型在 Windows 慎用 `low_cpu_mem_usage`**,有段错误风险。
6. **Blackwell(50 系)必须 cu128+**,cu126 会无声失败。
7. **"模型能力" ≠ "工程实现"**,这是这次最大的认知更新。标语、benchmark、demo 展示的都是模型能力上限,工程落地要打很多折扣。

## 一份检查清单

下次小显存本地部署大模型,按这个走:

- [ ] `torch.cuda.get_device_capability()` 确认算力,选对应 CUDA 版本 torch
- [ ] 大文件下载先 curl 测速选镜像(hf-mirror / SJTU / 阿里云)
- [ ] transformers / gradio / sglang 的 `huggingface-hub` 版本对齐
- [ ] trust_remote_code 模型:避免 `low_cpu_mem_usage=True`
- [ ] 小显存:`device_map="auto"` + `max_memory` 宽松,依赖 Windows 共享内存
- [ ] 加载后打印 `hf_device_map` 确认层分布全在 GPU
- [ ] 大 PDF:PyMuPDF 拆页 → 逐页推理,**不要** infer_multi
- [ ] 流式:stdout 劫持方案
- [ ] 文本后处理:清理 det 等版面标记
- [ ] Windows bat 脚本用 GBK 编码(cmd.exe 用 GBK 解析 .bat)
- [ ] WSL2:venv 建在 ext4 `~/`,别放 `/mnt/c`(drvfs 慢且易出权限问题)

## 最后

342 页 PDF 最终是转出来了,中文识别很准,表格和版面还原也比我预期好。整个过程最值钱的不是 OCR 结果本身,是踩出来的一套"消费级硬件跑大模型"的工程直觉——什么能省、什么不能省、哪些直觉是错的。

Unlimited-OCR 仓库:https://github.com/baidu/Unlimited-OCR

如果你也在小显存卡上折腾大模型,希望这篇能帮你少踩两个坑。
