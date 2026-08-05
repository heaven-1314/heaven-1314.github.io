import type { BooknavGroup, BooknavPageConfig } from "../types/booknavConfig";

// 书签导航页面配置
export const booknavPageConfig: BooknavPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// favicon 自动获取配置
	favicon: {
		// 书签未填写 icon 时，是否自动获取目标站点的 favicon 图标
		enabled: true,

		// favicon 接口地址，{domain} 为占位符，会被替换成目标站点域名
		// 更换接口只需保证地址里含有 {domain}，例如：
		//   https://a.favicon.im/{domain}
		//   https://favicon.im/{domain}
		api: "https://a.favicon.im/{domain}",
	},
};

// 书签导航配置
// 每个数组项是一个分类组，分类组内的 items 是该分类下的书签
export const booknavConfig: BooknavGroup[] = [
	{
		id: "dev",
		name: "开发",
		icon: "material-symbols:code-rounded",
		desc: "写代码时离不开的站点",
		weight: 100,
		items: [
			{
				title: "GitHub",
				url: "https://github.com",
				desc: "全球最大的代码托管平台",
				// icon 字段可以使用 astro-icon 图标库的图标名称
				// 也可以使用图片 URL 和本地图片路径
				// 不填则会通过接口自动获取目标站点的 favicon 图标（需要在上面配置）
				icon: "fa7-brands:github",
				weight: 10,
			},
			{
				title: "MDN Web Docs",
				url: "https://developer.mozilla.org",
				desc: "最权威的 Web 技术文档",
				weight: 9,
			},
			{
				title: "Python",
				url: "https://docs.python.org/zh-cn/3/",
				desc: "Python 官方文档（中文）",
				weight: 8,
			},
			{
				title: "FastAPI",
				url: "https://fastapi.tiangolo.com/zh/",
				desc: "Python 高性能 Web 框架",
				weight: 7,
			},
			{
				title: "Astro",
				url: "https://astro.build",
				desc: "内容驱动型网站的 Web 框架",
				weight: 6,
			},
			{
				title: "Tailwind CSS",
				url: "https://tailwindcss.com",
				desc: "实用优先的 CSS 框架",
				weight: 5,
			},
		],
	},
	{
		id: "design",
		name: "设计",
		icon: "material-symbols:palette-outline-rounded",
		desc: "配色、图标与灵感来源",
		weight: 90,
		items: [
			{
				title: "Iconify",
				url: "https://icon-sets.iconify.design",
				desc: "海量开源图标集合搜索",
				weight: 10,
			},
			{
				title: "iconfont",
				url: "https://www.iconfont.cn",
				desc: "阿里巴巴矢量图标库",
				weight: 9,
			},
		],
	},
	{
		id: "tools",
		name: "工具",
		icon: "material-symbols:build-outline-rounded",
		desc: "顺手的在线小工具",
		weight: 80,
		items: [
			{
				title: "TinyPNG",
				url: "https://tinypng.com",
				desc: "在线压缩 PNG / JPEG 图片",
				weight: 10,
			},
			{
				title: "Squoosh",
				url: "https://squoosh.app",
				desc: "Google 出品的图片压缩与格式转换",
				weight: 9,
			},
			{
				title: "Carbon",
				url: "https://carbon.now.sh",
				desc: "把代码片段生成漂亮的图片",
				weight: 8,
			},
		],
	},
	{
		id: "ai",
		name: "AI",
		icon: "material-symbols:smart-toy-outline-rounded",
		desc: "AI 平台与模型服务",
		weight: 70,
		items: [
			{
				title: "OpenAI",
				url: "https://platform.openai.com",
				desc: "OpenAI API 平台",
				weight: 10,
			},
			{
				title: "Anthropic Claude",
				url: "https://console.anthropic.com",
				desc: "Claude API 控制台",
				weight: 9,
			},
			{
				title: "Hugging Face",
				url: "https://huggingface.co",
				desc: "AI 模型与数据集社区",
				weight: 8,
			},
			{
				title: "DeepSeek",
				url: "https://platform.deepseek.com",
				desc: "深度求索开放平台",
				weight: 7,
			},
			{
				title: "Kimi",
				url: "https://platform.moonshot.cn",
				desc: "月之暗面 Kimi 开放平台",
				weight: 6,
			},
			{
				title: "阿里云百炼",
				url: "https://bailian.console.aliyun.com",
				desc: "阿里云大模型服务平台",
				weight: 5,
			},
		],
	},
];
