import type { ChatShortcut, ChatShortcutContext } from '../../Chat';

export interface GardenFlowComposerShortcutInput {
    label: string;
    text: string;
    displayContent?: string;
    action?: ChatShortcut['action'];
    creation?: ChatShortcut['creation'];
}

export type GardenFlowAttachmentShortcutScene =
    | 'uploaded_file'
    | 'uploaded_image'
    | 'uploaded_video';

export const GARDENFLOW_UPLOADED_FILE_ACTIONS: GardenFlowComposerShortcutInput[] = [
    {
        label: '总结文档内容',
        displayContent: '总结文档内容',
        text: [
            '请基于我上传的文件执行「文档内容总结」工作流。',
            '',
            '执行流程：',
            '1. 先读取附件内容，判断文件类型、主题、用途和可提取信息范围；不要只根据文件名总结。',
            '2. 如果文件无法读取、内容为空或需要密码/权限，停止执行并明确告诉我问题，不要编造摘要。',
            '3. 提取核心内容、关键结论、重要数据、可复用素材、潜在创作角度和需要核实的信息。',
            '4. 对事实做分层：确定信息、推断信息、缺失信息。凡是文件里没有依据的内容都标为「需补充」。',
            '5. 如果文件内容很长，先给结构化总览，再按章节/主题压缩，不要逐段复述。',
            '',
            '输出格式：',
            '- 一句话结论',
            '- 核心要点',
            '- 可复用素材',
            '- 创作机会',
            '- 风险/待确认',
            '- 下一步建议',
        ].join('\n'),
        action: 'send',
    },
    { label: '文章转卡片', text: '文章转卡片', action: 'creation', creation: { capability: 'note-image', presetId: 'article' } },
    { label: '文章转知识图解', text: '文章转知识图解', action: 'creation', creation: { capability: 'note-image', presetId: 'diagram' } },
    {
        label: '改写成文案',
        displayContent: '改写成文案',
        text: [
            '请基于我上传的文件执行「社媒文案改写」工作流。',
            '',
            '执行流程：',
            '1. 先读取文件并确认核心信息、事实边界、目标受众和可传播角度。',
            '2. 不要编造文件中没有的参数、案例、数据、资质或效果承诺。',
            '3. 如果缺少产品名、目标人群、平台或语气要求，先按通用社媒文案给出草稿，并列出需要我确认的变量。',
            '4. 改写时保留核心信息，压缩冗余表达，强化开头钩子、读者收益、行动号召和平台语气。',
            '5. 同时给出不同强度版本，方便我选择。',
            '',
            '输出格式：',
            '- 3 个标题备选',
            '- 主推文案 1 版',
            '- 更短版本 1 版',
            '- 更强销售感版本 1 版',
            '- 事实边界和需确认信息',
        ].join('\n'),
        action: 'send',
    },
];

export const GARDENFLOW_UPLOADED_IMAGE_ACTIONS: GardenFlowComposerShortcutInput[] = [
    { label: '制作商品套图', text: '制作商品套图', action: 'creation', creation: { capability: 'product-image-set' } },
    {
        label: '生成封面图',
        displayContent: '生成封面图',
        text: [
            '请基于我上传的图片执行「封面图生成」工作流。',
            '',
            '必须使用的工具：',
            '- 生成封面图必须调用 `image.generate`，不要只给方案。',
            '- 把上传图片作为 `referenceImages`，`generationMode` 使用 `reference-guided` 或等价参考图模式。',
            '- 调用 `image.generate` 时必须提供 `prompt`、`aspectRatio`、`quality`、`resolution`；默认 `quality: "high"`、`resolution: "2K"`。',
            '- 如果平台未知，默认小红书/社媒封面用 `aspectRatio: "3:4"`；如果明确是视频封面，用 `16:9` 或用户指定比例。',
            '',
            '执行流程：',
            '1. 先分析图片主体、情绪、反差、场景和视觉焦点，判断它适合哪类内容封面。',
            '2. 如果内容主题未知，先从图片推导 3 个可能主题，不要直接追问；只有图片无法判断主题时才问我。',
            '3. 输出 3 个封面方向，每个方向都包含目标读者、主标题、辅助文案、构图方式、字体感觉、色彩和视觉重心。',
            '4. 标出原图里必须保留、可以弱化、应该避开的元素，避免破坏识别度。',
            '5. 选择最推荐方向组装完整生成提示词，并调用 `image.generate` 生成 1 张封面；如果标题/平台会显著影响结果，先问最多 2 个必要问题。',
            '',
            '输出格式：',
            '- 图片封面潜力判断',
            '- 3 个封面方向',
            '- 推荐方向',
            '- 完整生成提示词',
            '- 需确认的标题/平台/风格',
        ].join('\n'),
        action: 'send',
    },
    {
        label: '生成同款图',
        displayContent: '生成同款图',
        text: [
            '请基于我上传的图片执行「同款视觉生成」工作流。',
            '',
            '必须使用的工具：',
            '- 生成同款图必须调用 `image.generate`，不要只输出拆解。',
            '- 把上传图片作为 `referenceImages`，`generationMode` 使用 `reference-guided` 或等价参考图模式。',
            '- 调用 `image.generate` 时必须提供 `prompt`、`aspectRatio`、`quality`、`resolution`；默认 `quality: "high"`、`resolution: "2K"`。',
            '- 如果要一次生成多个方向，必须提供 `sharedStyleGuide`、`imagePlanItems`、`count`；如果工具要求确认，先展示方向并等待确认。',
            '',
            '执行流程：',
            '1. 先拆解原图的构图、镜头距离、光线、色彩、材质、主体姿态、背景层次和整体风格。',
            '2. 提炼可复用的视觉 DNA，但不要要求复制商标、人物身份、受版权保护的具体角色或原图不可授权元素。',
            '3. 如果用户没有指定用途，默认输出 3 个方向：产品展示、生活方式、社媒封面。',
            '4. 每个方向都给完整图片生成提示词、负面约束和可替换变量。',
            '5. 若目标方向明确，直接调用 `image.generate` 生成同款图；若存在多个方向且无法判断用户偏好，先让我选择方向。',
            '',
            '输出格式：',
            '- 原图视觉 DNA',
            '- 3 个同款方向',
            '- 每个方向的生成提示词',
            '- 负面提示词',
            '- 商业化使用风险',
        ].join('\n'),
        action: 'send',
    },
    {
        label: '提取卖点文案',
        displayContent: '提取卖点文案',
        text: [
            '请基于我上传的图片执行「卖点文案提取」工作流。',
            '',
            '工具使用要求：',
            '- 这个按钮只做图片理解和文案提炼，默认不调用 `image.generate`。',
            '- 如果我追问要把卖点做成海报、主图或卡片，再调用 `image.generate`；调用时必须携带 `prompt`、`aspectRatio`、`quality`、`resolution` 和必要的 `referenceImages`。',
            '',
            '执行流程：',
            '1. 先识别图片里的产品/主体、场景、用户利益、情绪价值和视觉证据。',
            '2. 只提炼图片能支持的卖点；不要编造参数、功效、销量、认证、价格或不可验证事实。',
            '3. 如果产品信息不足，使用「可见信息 + 合理假设」输出，并明确哪些文案需要用户确认后才能使用。',
            '4. 输出多种可直接放到不同位置的短文案，每条都标注适用位置。',
            '5. 最后给一组最推荐的标题 + 副文案组合，并说明为什么。',
            '',
            '输出格式：',
            '- 可见卖点',
            '- 需确认卖点',
            '- 10 条短标题',
            '- 5 条详情页卖点',
            '- 5 条社媒投放文案',
            '- 推荐组合',
        ].join('\n'),
        action: 'send',
    },
];

export const GARDENFLOW_UPLOADED_VIDEO_ACTIONS: GardenFlowComposerShortcutInput[] = [
    {
        label: '爆款分析',
        displayContent: '爆款分析',
        text: [
            '请基于我上传的视频执行「爆款分析」工作流。',
            '',
            '必须使用的工具：',
            '- 先调用 `video.analyze` 分析视频画面、镜头、节奏、片段和爆点。',
            '- 不要用 `media.transcribe` 替代视频分析；只有需要校验口播/字幕文本时，才补充调用 `media.transcribe`。',
            '',
            '执行流程：',
            '1. 先调用 `video.analyze` 完整读取视频内容；不要只凭文件名、封面或用户主观描述判断。',
            '2. 如果视频无法分析，停止并说明缺少什么能力/文件信息，不要编造片段。',
            '3. 如视频分析结果无法可靠覆盖口播/字幕，再调用 `media.transcribe` 读取文本内容；否则不要额外转写。',
            '4. 分析前 3 秒钩子、核心主题、情绪曲线、节奏变化、内容结构、视觉记忆点、可复用金句和字幕表达。',
            '5. 标出最可能带来完播、收藏、评论或转发的片段，并说明触发机制。',
            '6. 判断当前视频的问题：开头、节奏、信息密度、表达顺序、画面素材、字幕、结尾行动号召。',
            '7. 输出改造方案，不直接剪辑或生成文件；如需要剪辑，应建议用户点击「剪辑切片」。',
            '8. 不要声称分析报告已保存；只有在明确调用 workspace.write 并成功返回路径后，才能输出“已保存”和对应 workspace:// Markdown 链接。',
            '',
            '输出格式：',
            '- 爆款潜力评分',
            '- 前 3 秒分析',
            '- 内容结构拆解',
            '- 高价值片段清单',
            '- 主要问题',
            '- 改造方案',
            '- 标题/封面/发布建议',
        ].join('\n'),
        action: 'send',
    },
    {
        label: '字幕提取',
        displayContent: '字幕提取',
        text: [
            '请基于我上传的视频执行「字幕提取」工作流。',
            '',
            '必须使用的工具：',
            '- 调用 `media.transcribe`，并显式设置 `format: "srt"`，让工具生成 SRT 字幕文件。',
            '- 不要调用 `video.analyze` 来做字幕提取；视频分析不是字幕/ASR 工具。',
            '',
            '执行流程：',
            '1. 先调用 `media.transcribe` 读取上传视频，参数使用 `sourcePath` 指向该视频附件，`format` 使用 `srt`。',
            '2. 如果已有内嵌字幕或可直接提取字幕轨，优先保留原始时间轴；否则做语音转写并生成 SRT。',
            '3. 工具返回后，必须输出 `subtitlePath`/字幕文件路径；如果生成失败，说明具体失败原因，不要编造路径。',
            '4. 保留时间顺序；对听不清、多人重叠、疑似错字、专有名词不确定的片段单独标注。',
            '5. 不要对字幕内容做创作性改写；只做必要断句、错别字提示和清洁排版。',
            '',
            '输出格式：',
            '- 字幕文件路径（如有）',
            '- 清洁字幕文本',
            '- 需人工确认片段',
            '- 视频内容摘要',
            '- 后续可执行建议',
        ].join('\n'),
        action: 'send',
    },
    {
        label: '剪辑切片',
        displayContent: '剪辑切片',
        text: [
            '请基于我上传的视频执行「剪辑切片」工作流。',
            '',
            '必须使用的工具：',
            '- 先调用 `video.analyze` 找出精彩片段、时间点和切片理由。',
            '- 需要实际产出切片文件时，调用 `media.edit`，用 `operations` 里的 `trim` 操作生成独立视频片段。',
            '- `media.edit` 的每个 `trim` 操作应包含 `type: "trim"`、`startMs`、`durationMs` 和清晰的 `label`；多片段输出时设置 `output.kind: "clips"`。',
            '- 如需要字幕辅助判断口播边界，再补充调用 `media.transcribe`，但不要用转写替代视频分析。',
            '',
            '执行流程：',
            '1. 先调用 `video.analyze` 完整分析视频，识别可独立发布的精彩片段；不要跳过分析直接剪。',
            '2. 给出候选切片清单：开始时间、结束时间、片段主题、爆点理由、上下文是否完整、适合平台和推荐标题。',
            '3. 如果片段边界不确定，先输出候选并请求我确认；不要盲剪。',
            '4. 如果片段边界清晰且 `media.edit` 可用，选择最值得产出的 3-5 个片段，分别用 `trim` 操作剪辑成独立视频文件。',
            '5. 每个成片要尽量保留上下文完整性，不要只剪一句没有前后语义的话。',
            '6. `media.edit` 返回后，输出每个切片的文件路径、时间范围和用途；如果剪辑失败，保留候选清单并说明失败原因与下一步需要的输入。',
            '7. 只有 `media.edit` 或 workspace.write 成功返回真实路径后，才能说文件已生成/已保存；最终回复必须使用工具返回的路径，不要编造只有文件名的链接。',
            '',
            '输出格式：',
            '- 候选切片清单',
            '- 已生成文件路径（如已剪辑）',
            '- 未剪辑/需确认片段',
            '- 推荐发布顺序',
            '- 每个切片的标题建议',
        ].join('\n'),
        action: 'send',
    },
];

export const GARDENFLOW_ATTACHMENT_ACTIONS_BY_SCENE: Record<GardenFlowAttachmentShortcutScene, GardenFlowComposerShortcutInput[]> = {
    uploaded_file: GARDENFLOW_UPLOADED_FILE_ACTIONS,
    uploaded_image: GARDENFLOW_UPLOADED_IMAGE_ACTIONS,
    uploaded_video: GARDENFLOW_UPLOADED_VIDEO_ACTIONS,
};

function isImageShortcutAttachment(context: ChatShortcutContext): boolean {
    const attachment = context.attachment;
    if (!attachment) return false;
    const kind = String(attachment.kind || '').trim().toLowerCase();
    const mimeType = String(attachment.mimeType || '').trim().toLowerCase();
    const name = String(
        attachment.name
        || attachment.localUrl
        || attachment.absolutePath
        || attachment.originalAbsolutePath
        || '',
    ).trim();
    return kind === 'image'
        || mimeType.startsWith('image/')
        || /\.(png|jpe?g|webp|gif|bmp|svg|avif)(?:[?#].*)?$/i.test(name);
}

function isVideoShortcutAttachment(context: ChatShortcutContext): boolean {
    const attachment = context.attachment;
    if (!attachment) return false;
    const kind = String(attachment.kind || '').trim().toLowerCase();
    const mimeType = String(attachment.mimeType || '').trim().toLowerCase();
    const name = String(
        attachment.name
        || attachment.localUrl
        || attachment.absolutePath
        || attachment.originalAbsolutePath
        || '',
    ).trim();
    return kind === 'video'
        || mimeType.startsWith('video/')
        || /\.(mp4|mov|m4v|webm|mkv|avi)(?:[?#].*)?$/i.test(name);
}

export function resolveGardenFlowAttachmentShortcutScene(context: ChatShortcutContext): GardenFlowAttachmentShortcutScene {
    if (isVideoShortcutAttachment(context)) return 'uploaded_video';
    return isImageShortcutAttachment(context) ? 'uploaded_image' : 'uploaded_file';
}
