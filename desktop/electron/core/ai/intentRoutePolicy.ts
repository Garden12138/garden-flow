import type { IntentName, RoleId } from './types';

export const INTENT_NAMES: IntentName[] = [
  'direct_answer',
  'file_operation',
  'manuscript_creation',
  'image_creation',
  'video_creation',
  'audio_creation',
  'cover_generation',
  'knowledge_retrieval',
  'long_running_task',
  'discussion',
  'memory_maintenance',
  'automation',
  'advisor_persona',
];

export const recommendedRoleForIntent = (intent: IntentName): RoleId => {
  switch (intent) {
    case 'knowledge_retrieval':
    case 'advisor_persona':
      return 'researcher';
    case 'image_creation':
    case 'cover_generation':
      return 'image-director';
    case 'video_creation':
      return 'video-director';
    case 'audio_creation':
      return 'audio-director';
    case 'automation':
    case 'long_running_task':
    case 'memory_maintenance':
      return 'ops-coordinator';
    case 'manuscript_creation':
      return 'copywriter';
    case 'discussion':
      return 'planner';
    case 'file_operation':
    case 'direct_answer':
    default:
      return 'planner';
  }
};

export const requiredCapabilitiesForIntent = (intent: IntentName): string[] => {
  switch (intent) {
    case 'manuscript_creation':
      return ['planning', 'writing', 'artifact-save'];
    case 'image_creation':
    case 'cover_generation':
      return ['planning', 'image-generation', 'artifact-save'];
    case 'video_creation':
      return ['planning', 'video-generation', 'artifact-save'];
    case 'audio_creation':
      return ['planning', 'audio-generation', 'artifact-save'];
    case 'knowledge_retrieval':
    case 'advisor_persona':
      return ['knowledge-retrieval', 'evidence-synthesis'];
    case 'automation':
    case 'long_running_task':
      return ['task-graph', 'background-runner', 'artifact-save'];
    case 'memory_maintenance':
      return ['memory-read', 'memory-write', 'profile-doc'];
    case 'discussion':
      return ['multi-agent-discussion'];
    case 'file_operation':
      return ['file-read-write'];
    default:
      return ['direct-answer'];
  }
};

export const resolveIntentExecutionPolicy = (params: {
  intent: IntentName;
  declaredCapabilities?: string[];
  recommendedRole?: RoleId | null;
}): { requiredCapabilities: string[]; recommendedRole: RoleId } => ({
  requiredCapabilities: Array.from(new Set([
    ...requiredCapabilitiesForIntent(params.intent),
    ...(params.declaredCapabilities || []),
  ])),
  recommendedRole: params.intent === 'video_creation' || params.intent === 'audio_creation'
    ? recommendedRoleForIntent(params.intent)
    : params.recommendedRole || recommendedRoleForIntent(params.intent),
});
