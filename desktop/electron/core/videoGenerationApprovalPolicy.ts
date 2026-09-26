export type VideoGenerationApprovalDecision = {
    outcome: 'confirm' | 'deny';
    reason: string;
    requiresUserAcknowledgement: true;
};

export function evaluateVideoGenerationApprovalPolicy(params: {
    toolName: string;
    interactive: boolean;
}): VideoGenerationApprovalDecision | null {
    if (params.toolName !== 'video_generate') return null;
    return {
        outcome: params.interactive ? 'confirm' : 'deny',
        reason: '视频生成会提交外部模型任务并消耗生成额度，必须由用户主动确认。',
        requiresUserAcknowledgement: true,
    };
}
