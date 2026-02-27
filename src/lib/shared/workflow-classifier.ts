// =============================================================================
// Workflow Classifier — Maps natural language goals to suggested configurations
// =============================================================================
// Simple regex-based intent classifier. Used by OrchestratorLauncher to
// auto-suggest model tier and relevant personas.

interface WorkflowSuggestion {
  model: string;
  personaRoles: string[];
  template: string;
}

const patterns: Array<{ regex: RegExp; suggestion: WorkflowSuggestion }> = [
  {
    regex: /^(fix|typo|rename|update\s+(readme|docs|doc|documentation))/i,
    suggestion: { model: 'haiku', personaRoles: ['Backend'], template: 'single-dev' },
  },
  {
    regex: /^(add|implement|create|build)/i,
    suggestion: { model: 'sonnet', personaRoles: ['Architect', 'Backend', 'Frontend'], template: 'full-stack' },
  },
  {
    regex: /(security|audit|vulnerability|pentest|cve)/i,
    suggestion: { model: 'sonnet', personaRoles: ['Reviewer', 'DevOps'], template: 'security-audit' },
  },
  {
    regex: /(test|coverage|e2e|integration test|unit test)/i,
    suggestion: { model: 'sonnet', personaRoles: ['Tester', 'Backend'], template: 'testing' },
  },
  {
    regex: /(refactor|restructure|reorganize|clean\s*up)/i,
    suggestion: { model: 'sonnet', personaRoles: ['Architect', 'Backend', 'Reviewer'], template: 'refactor' },
  },
  {
    regex: /(deploy|ci|cd|pipeline|docker|infra)/i,
    suggestion: { model: 'sonnet', personaRoles: ['DevOps', 'Backend'], template: 'devops' },
  },
  {
    regex: /(review|code\s*review|pr\s*review)/i,
    suggestion: { model: 'opus', personaRoles: ['Reviewer', 'Architect'], template: 'review' },
  },
  {
    regex: /(design|architect|plan|rfc|adr)/i,
    suggestion: { model: 'opus', personaRoles: ['Architect'], template: 'design' },
  },
  {
    regex: /(ui|ux|frontend|component|page|layout|style)/i,
    suggestion: { model: 'sonnet', personaRoles: ['Frontend', 'Reviewer'], template: 'frontend' },
  },
  {
    regex: /(api|endpoint|backend|database|migration|schema)/i,
    suggestion: { model: 'sonnet', personaRoles: ['Backend', 'Reviewer'], template: 'backend' },
  },
];

/**
 * Classify a goal string and return a suggested workflow configuration.
 * Returns null if no pattern matches.
 */
export function classifyWorkflow(goal: string): WorkflowSuggestion | null {
  const trimmed = goal.trim();
  if (!trimmed) return null;

  for (const { regex, suggestion } of patterns) {
    if (regex.test(trimmed)) {
      return suggestion;
    }
  }

  // Default suggestion for unclassified goals
  return { model: 'sonnet', personaRoles: ['Backend', 'Frontend'], template: 'general' };
}
