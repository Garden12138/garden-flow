import { z } from 'zod';
import {
    DeclarativeTool,
    ToolKind,
    type ToolResult,
    createSuccessResult,
    createErrorResult,
    ToolErrorType,
} from '../toolRegistry';
import { SkillManager } from '../skillManager';

const SkillParamsSchema = z.object({
    skill: z.string().describe('The skill name to load'),
});

type SkillParams = z.infer<typeof SkillParamsSchema>;

export class SkillTool extends DeclarativeTool<typeof SkillParamsSchema> {
    readonly name = 'skill';
    readonly displayName = 'Load Skill';
    get description(): string {
        return this.skillManager.getSkillToolDescription();
    }
    readonly kind = ToolKind.Other;
    readonly parameterSchema = SkillParamsSchema;
    readonly requiresConfirmation = false;

    constructor(
        private readonly skillManager: SkillManager,
        private readonly onActivated?: (payload: { name: string; description: string }) => void,
    ) {
        super();
    }

    getDescription(params: SkillParams): string {
        const skillName = String(params.skill || '').trim();
        return skillName ? `load skill: ${skillName}` : 'load skill';
    }

    protected validateValues(params: SkillParams): string | null {
        const skillName = String(params.skill || '').trim();
        if (!skillName) {
            return '`skill` is required.';
        }
        return null;
    }

    async execute(params: SkillParams, _signal: AbortSignal): Promise<ToolResult> {
        const requestedSkill = String(params.skill || '').trim();
        const activated = requestedSkill ? await this.skillManager.activateSkill(requestedSkill) : null;
        if (!activated) {
            const available = this.skillManager.getSkills().map((skill) => skill.name).join(', ');
            return createErrorResult(
                `Skill "${requestedSkill}" not found or disabled. Available skills: ${available || 'none'}.`,
                ToolErrorType.INVALID_PARAMS,
            );
        }

        const skill = this.skillManager.getSkill(requestedSkill);
        this.onActivated?.({
            name: skill?.name || requestedSkill,
            description: skill?.description || `技能 ${requestedSkill} 已激活`,
        });
        return createSuccessResult(activated, `Skill "${skill?.name || requestedSkill}" loaded.`);
    }
}
