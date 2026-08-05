import type { SponsorConfig } from "../types/sponsorConfig";

export const sponsorConfig: SponsorConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// 打赏用途说明
	usage:
		"如果我的文章对你有帮助，欢迎打赏支持，让我有动力持续产出更多内容。",

	// 是否显示打赏者列表
	showSponsorsList: true,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: false,

	// 是否在文章详情页底部显示打赏按钮
	showButtonInPost: false,

	// 打赏方式列表（待配置收款码后启用）
	methods: [],

	// 打赏者列表（可选）
	sponsors: [],
};
