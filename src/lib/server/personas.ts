import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import type { Persona, PersonaInput } from '$lib/types/persona';

export function listPersonas(): Persona[] {
  const db = getDb();
  return db.prepare('SELECT * FROM personas ORDER BY name ASC').all() as Persona[];
}

export function getPersona(id: string): Persona | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as Persona | undefined;
}

export function createPersona(input: PersonaInput): Persona {
  const db = getDb();
  const id = uuid();

  const existing = db.prepare('SELECT id FROM personas WHERE name = ?').get(input.name);
  if (existing) {
    throw { code: 'DUPLICATE_NAME', message: `Persona '${input.name}' already exists.` };
  }

  if (!input.name || !input.name.trim()) {
    throw { code: 'VALIDATION_ERROR', message: 'Persona name is required.' };
  }
  if (!input.role || !input.role.trim()) {
    throw { code: 'VALIDATION_ERROR', message: 'Persona role is required.' };
  }

  db.prepare(`
    INSERT INTO personas (id, name, role, avatar, description, instructions)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name.trim(),
    input.role.trim(),
    input.avatar ?? '🤖',
    input.description ?? null,
    input.instructions ?? ''
  );

  return getPersona(id) as Persona;
}

export function updatePersona(id: string, input: Partial<PersonaInput>): Persona {
  const db = getDb();
  const existing = getPersona(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Persona not found.' };
  }

  if (input.name && input.name !== existing.name) {
    const dupe = db.prepare('SELECT id FROM personas WHERE name = ? AND id != ?').get(input.name, id);
    if (dupe) {
      throw { code: 'DUPLICATE_NAME', message: `Persona '${input.name}' already exists.` };
    }
  }

  db.prepare(`
    UPDATE personas
    SET name = ?, role = ?, avatar = ?, description = ?, instructions = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name?.trim() ?? existing.name,
    input.role?.trim() ?? existing.role,
    input.avatar ?? existing.avatar,
    input.description !== undefined ? (input.description ?? null) : existing.description,
    input.instructions ?? existing.instructions,
    id
  );

  return getPersona(id) as Persona;
}

export function deletePersona(id: string): void {
  const db = getDb();
  const existing = getPersona(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Persona not found.' };
  }

  // Check if any environments reference this persona
  const usage = db.prepare('SELECT COUNT(*) as count FROM environments WHERE persona_id = ?').get(id) as { count: number };
  if (usage.count > 0) {
    throw { code: 'IN_USE', message: `Cannot delete persona '${existing.name}' — it is assigned to ${usage.count} environment(s).` };
  }

  db.prepare('DELETE FROM personas WHERE id = ?').run(id);
}

/**
 * Seed default personas if none exist. Called once at startup.
 */
export function seedDefaultPersonas(): void {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as n FROM personas').get() as { n: number };
  if (count.n > 0) return;

  const defaults: Array<Omit<PersonaInput, 'avatar'> & { avatar: string }> = [
    {
      name: 'Architect',
      role: 'Software Architect',
      avatar: '🏗️',
      description: 'Designs system architecture, writes ADRs, defines interfaces and data models.',
      instructions: [
        'Focus on high-level design, not implementation details.',
        'Write Architecture Decision Records (ADRs) in docs/ for significant choices.',
        'Define clear interfaces, data models, and module boundaries before implementation begins.',
        'Consider scalability, security, and maintainability trade-offs explicitly.',
        'When reviewing others\' work, evaluate against the architecture — flag drift early.',
        'Prefer composition over inheritance. Prefer simple solutions over clever ones.',
      ].join('\n'),
    },
    {
      name: 'Backend',
      role: 'Backend Engineer',
      avatar: '⚙️',
      description: 'Implements server-side logic, APIs, database queries, and integrations.',
      instructions: [
        'Write clean, well-structured server-side code with proper error handling.',
        'All database queries must use parameterized placeholders — never interpolate values.',
        'Validate all inputs at system boundaries. Return structured error objects.',
        'Write functions that do one thing well. Keep API handlers thin — business logic goes in modules.',
        'Consider edge cases: empty results, concurrent access, partial failures.',
        'Add tests for non-trivial logic, especially data transformations and error paths.',
      ].join('\n'),
    },
    {
      name: 'Frontend',
      role: 'Frontend Engineer',
      avatar: '🎨',
      description: 'Builds user interfaces, components, and client-side interactions.',
      instructions: [
        'Build responsive, accessible UI components with semantic HTML.',
        'Keep components small and focused. Extract reusable pieces when patterns repeat.',
        'Handle loading states, empty states, and error states in every view.',
        'Use reactive state correctly — avoid unnecessary re-renders and stale closures.',
        'Style with CSS that follows existing conventions in the project.',
        'Consider keyboard navigation and screen readers for interactive elements.',
      ].join('\n'),
    },
    {
      name: 'Tester',
      role: 'QA Engineer',
      avatar: '🧪',
      description: 'Writes and runs tests, identifies edge cases, validates correctness.',
      instructions: [
        'Write tests that verify behavior, not implementation details.',
        'Cover the happy path first, then edge cases: empty inputs, boundaries, error conditions.',
        'For integration tests, test the actual API contracts — request/response shapes and status codes.',
        'When you find a bug, write a failing test FIRST, then report the issue with reproduction steps.',
        'Organize tests to mirror the source structure. Name tests clearly: "should X when Y".',
        'Don\'t mock what you don\'t own. Prefer real implementations over mocks when practical.',
      ].join('\n'),
    },
    {
      name: 'Reviewer',
      role: 'Code Reviewer',
      avatar: '🔍',
      description: 'Reviews code for correctness, security, performance, and maintainability.',
      instructions: [
        'Review code for: correctness, security vulnerabilities, performance issues, and readability.',
        'Check for OWASP top 10: injection, XSS, broken auth, sensitive data exposure.',
        'Flag over-engineering: unnecessary abstractions, premature optimization, dead code.',
        'Verify error handling is complete — what happens when things fail?',
        'Check that changes are consistent with existing patterns in the codebase.',
        'Be specific in feedback: point to the exact line/function and suggest a concrete fix.',
      ].join('\n'),
    },
    {
      name: 'DevOps',
      role: 'DevOps Engineer',
      avatar: '🚀',
      description: 'Handles deployment, infrastructure, CI/CD, monitoring, and operations.',
      instructions: [
        'Focus on reliability, reproducibility, and automation.',
        'Write Dockerfiles that produce small, secure images — multi-stage builds, non-root users.',
        'CI/CD pipelines should be fast, deterministic, and fail clearly with actionable messages.',
        'Infrastructure changes should be idempotent — safe to run repeatedly.',
        'Add health checks, structured logging, and graceful shutdown handling.',
        'Document operational runbooks for common failure scenarios.',
      ].join('\n'),
    },
  ];

  // Default model tiers per persona
  const modelDefaults: Record<string, string> = {
    'Architect': 'opus',
    'Reviewer': 'opus',
    'Backend': 'sonnet',
    'Frontend': 'sonnet',
    'Tester': 'haiku',
    'DevOps': 'haiku',
  };

  const insert = db.prepare(`
    INSERT INTO personas (id, name, role, avatar, description, instructions, default_model)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const p of defaults) {
      insert.run(uuid(), p.name, p.role, p.avatar, p.description, p.instructions, modelDefaults[p.name] ?? 'sonnet');
    }
  });
  tx();

  console.log(`[spyre] Seeded ${defaults.length} default personas.`);
}

export function getPersonaUsageCounts(): Record<string, number> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT persona_id, COUNT(*) as count FROM environments WHERE persona_id IS NOT NULL GROUP BY persona_id'
  ).all() as Array<{ persona_id: string; count: number }>;

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.persona_id] = row.count;
  }
  return counts;
}
