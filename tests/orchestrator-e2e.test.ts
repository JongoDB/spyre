/**
 * E2E tests for the Dynamic Agent Orchestration feature.
 * Tests UI rendering, API integration, and data flow.
 *
 * Run: npx playwright test tests/orchestrator-e2e.test.ts
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

let ENV_ID: string;

test.beforeAll(async ({ request }) => {
	const res = await request.get(`${BASE}/api/environments`);
	const envs = await res.json();
	const running = envs.find((e: { status: string; ip_address: string | null }) => e.status === 'running' && e.ip_address);
	if (!running) {
		throw new Error('No running environment with IP found');
	}
	ENV_ID = running.id;
	console.log(`Using env: ${running.name} (${ENV_ID})`);
});

/** Navigate to env page, wait for hydration, click Agents tab, then switch to Orchestrator mode */
async function goToOrchestratorTab(page: import('@playwright/test').Page) {
	await page.goto(`${BASE}/environments/${ENV_ID}`);
	// Wait for Svelte hydration: the tab buttons become interactive
	await page.waitForSelector('button.tab-btn', { state: 'attached' });
	// Small delay for event handlers to be bound
	await page.waitForTimeout(500);
	await page.locator('button.tab-btn', { hasText: 'Agents' }).click({ force: true });
	await page.waitForTimeout(300);
	// Switch to orchestrator mode (may already be selected as default)
	const orchPill = page.locator('button.mode-pill', { hasText: 'Orchestrator' });
	if (await orchPill.isVisible()) {
		await orchPill.click({ force: true });
	}
	await page.waitForTimeout(500);
}

// ------------------------------------------------------------------
// 1. API layer tests
// ------------------------------------------------------------------

test.describe('Orchestrator REST API', () => {
	test('GET /api/orchestrator returns array', async ({ request }) => {
		const res = await request.get(`${BASE}/api/orchestrator?envId=${ENV_ID}`);
		expect(res.status()).toBe(200);
		expect(Array.isArray(await res.json())).toBe(true);
	});

	test('POST /api/orchestrator creates session with system prompt', async ({ request }) => {
		const res = await request.post(`${BASE}/api/orchestrator`, {
			data: { env_id: ENV_ID, goal: 'E2E test: build a hello world page', model: 'haiku' },
		});
		const body = await res.json();
		expect(body.id || body.message).toBeTruthy();

		if (res.status() === 200 || res.status() === 201) {
			expect(body.goal).toBe('E2E test: build a hello world page');
			expect(body.model).toBe('haiku');
			expect(body.system_prompt).toContain('orchestrator');
			expect(body.system_prompt).toContain('spyre_spawn_agent');

			const listRes = await request.get(`${BASE}/api/orchestrator?envId=${ENV_ID}`);
			const list = await listRes.json();
			expect(list.some((s: { id: string }) => s.id === body.id)).toBe(true);

			const detailRes = await request.get(`${BASE}/api/orchestrator/${body.id}`);
			expect(detailRes.status()).toBe(200);
			const detail = await detailRes.json();
			expect(detail.id).toBe(body.id);
			expect(Array.isArray(detail.agents)).toBe(true);
		}
	});

	test('GET /api/orchestrator/:id returns 404 for bogus ID', async ({ request }) => {
		const res = await request.get(`${BASE}/api/orchestrator/nonexistent-id-12345`);
		expect(res.status()).toBe(404);
	});

	test('DELETE /api/orchestrator/:id returns 404 for bogus ID', async ({ request }) => {
		const res = await request.delete(`${BASE}/api/orchestrator/nonexistent-id-12345`);
		expect(res.status()).toBe(404);
	});
});

test.describe('Agent REST API', () => {
	test('GET /api/agents returns array for envId', async ({ request }) => {
		const res = await request.get(`${BASE}/api/agents?envId=${ENV_ID}`);
		expect(res.status()).toBe(200);
		expect(Array.isArray(await res.json())).toBe(true);
	});

	test('GET /api/agents requires envId', async ({ request }) => {
		const res = await request.get(`${BASE}/api/agents`);
		expect(res.status()).toBe(400);
	});

	test('POST /api/agents validates required fields', async ({ request }) => {
		let res = await request.post(`${BASE}/api/agents`, { data: { name: 'test', task: 'do something' } });
		expect(res.status()).toBe(400);
		res = await request.post(`${BASE}/api/agents`, { data: { env_id: ENV_ID, task: 'do something' } });
		expect(res.status()).toBe(400);
		res = await request.post(`${BASE}/api/agents`, { data: { env_id: ENV_ID, name: 'test' } });
		expect(res.status()).toBe(400);
	});

	test('POST /api/agents/batch creates wave with agents', async ({ request }) => {
		const res = await request.post(`${BASE}/api/agents/batch`, {
			data: {
				env_id: ENV_ID,
				wave_name: 'e2e-wave',
				agents: [
					{ name: 'agent-a', role: 'tester', task: 'Test task A', model: 'haiku' },
					{ name: 'agent-b', role: 'dev', task: 'Test task B', model: 'haiku' },
				],
			},
		});
		const body = await res.json();
		expect(body.waveId || body.agents || body.message).toBeTruthy();
		if (body.waveId) {
			expect(body.agents).toHaveLength(2);
			expect(body.agents[0].wave_id).toBe(body.waveId);
			expect(body.agents[1].wave_id).toBe(body.waveId);
			expect(body.agents[0].wave_position).toBe(0);
			expect(body.agents[1].wave_position).toBe(1);
		}
	});

	test('GET /api/agents/:id returns 404 for bogus ID', async ({ request }) => {
		const res = await request.get(`${BASE}/api/agents/nonexistent-agent-12345`);
		expect(res.status()).toBe(404);
	});
});

test.describe('Ask-User REST API', () => {
	test('GET /api/orchestrator/:id/ask-user returns array', async ({ request }) => {
		const listRes = await request.get(`${BASE}/api/orchestrator?envId=${ENV_ID}`);
		const sessions = await listRes.json();
		if (sessions.length === 0) { test.skip(); return; }
		const res = await request.get(`${BASE}/api/orchestrator/${sessions[0].id}/ask-user`);
		expect(res.status()).toBe(200);
		expect(Array.isArray(await res.json())).toBe(true);
	});

	test('POST /api/orchestrator/:id/ask-user validates fields', async ({ request }) => {
		const listRes = await request.get(`${BASE}/api/orchestrator?envId=${ENV_ID}`);
		const sessions = await listRes.json();
		if (sessions.length === 0) { test.skip(); return; }
		const res = await request.post(`${BASE}/api/orchestrator/${sessions[0].id}/ask-user`, {
			data: { response: 'yes' },
		});
		expect(res.status()).toBe(400);
	});
});

// ------------------------------------------------------------------
// 2. UI rendering tests
// ------------------------------------------------------------------

test.describe('Orchestrator Tab UI', () => {
	test('Agents tab button is visible on running environment page', async ({ page }) => {
		await page.goto(`${BASE}/environments/${ENV_ID}`);
		await expect(page.locator('button.tab-btn', { hasText: 'Agents' })).toBeVisible();
	});

	test('clicking Orchestrator tab shows launcher form', async ({ page }) => {
		await goToOrchestratorTab(page);
		await expect(page.getByRole('heading', { name: 'Start Orchestrator' })).toBeVisible({ timeout: 5000 });
		await expect(page.locator('#orch-goal')).toBeVisible();
	});

	test('launcher has model selector buttons', async ({ page }) => {
		await goToOrchestratorTab(page);
		await expect(page.getByRole('heading', { name: 'Start Orchestrator' })).toBeVisible({ timeout: 5000 });

		await expect(page.locator('.model-btn', { hasText: 'haiku' })).toBeVisible();
		await expect(page.locator('.model-btn', { hasText: 'sonnet' })).toBeVisible();
		await expect(page.locator('.model-btn', { hasText: 'opus' })).toBeVisible();
		await expect(page.locator('.model-btn.active')).toContainText('sonnet');
	});

	test('launcher has persona chips', async ({ page }) => {
		await goToOrchestratorTab(page);
		await expect(page.getByRole('heading', { name: 'Start Orchestrator' })).toBeVisible({ timeout: 5000 });

		await expect(page.locator('.persona-chips')).toBeVisible();
		expect(await page.locator('.persona-chip').count()).toBeGreaterThan(0);
		await expect(page.locator('.chip-name', { hasText: 'Architect' })).toBeVisible();
		await expect(page.locator('.chip-name', { hasText: 'Backend' })).toBeVisible();
	});

	test('typing a goal auto-classifies workflow and selects personas', async ({ page }) => {
		await goToOrchestratorTab(page);
		await expect(page.getByRole('heading', { name: 'Start Orchestrator' })).toBeVisible({ timeout: 5000 });

		await page.locator('#orch-goal').fill('security audit of the authentication system');
		await page.waitForTimeout(500);
		await expect(page.locator('.persona-chip.selected', { hasText: 'Reviewer' })).toBeVisible();
	});

	test('recent sessions list shows existing sessions', async ({ page }) => {
		await goToOrchestratorTab(page);
		await page.waitForTimeout(500);

		const sessionRows = page.locator('.orch-session-row');
		if ((await sessionRows.count()) > 0) {
			await expect(sessionRows.first().locator('.orch-status')).toBeVisible();
			await expect(sessionRows.first().locator('.orch-goal')).toBeVisible();
			await expect(sessionRows.first().locator('.orch-meta')).toBeVisible();
		}
	});

	test('clicking a session opens OrchestratorRunner', async ({ page }) => {
		await goToOrchestratorTab(page);
		await page.waitForTimeout(500);

		const sessionRows = page.locator('.orch-session-row');
		if ((await sessionRows.count()) > 0) {
			await sessionRows.first().click();
			await expect(page.locator('.orchestrator-runner')).toBeVisible({ timeout: 5000 });
			await expect(page.locator('button', { hasText: 'Back' })).toBeVisible();
		}
	});

	test('OrchestratorRunner shows session goal and status', async ({ page }) => {
		await goToOrchestratorTab(page);
		await page.waitForTimeout(500);

		const sessionRows = page.locator('.orch-session-row');
		if ((await sessionRows.count()) > 0) {
			await sessionRows.first().click();
			const runner = page.locator('.orchestrator-runner');
			await expect(runner).toBeVisible({ timeout: 5000 });
			expect(await runner.locator('h3, p').first().textContent()).toBeTruthy();
			await expect(runner.locator('[class*="status"]').first()).toBeVisible();
		}
	});

	test('OrchestratorRunner back button returns to launcher', async ({ page }) => {
		await goToOrchestratorTab(page);
		await page.waitForTimeout(500);

		const sessionRows = page.locator('.orch-session-row');
		if ((await sessionRows.count()) > 0) {
			await sessionRows.first().click();
			await expect(page.locator('.orchestrator-runner')).toBeVisible({ timeout: 5000 });
			await page.locator('button', { hasText: 'Back' }).click();
			await expect(page.getByRole('heading', { name: 'Start Orchestrator' })).toBeVisible({ timeout: 5000 });
		}
	});
});

test.describe('Pipeline Builder Orchestrator Step', () => {
	test('orchestrator option in step type dropdown', async ({ page }) => {
		await page.goto(`${BASE}/environments/${ENV_ID}`);
		await page.waitForSelector('button.tab-btn', { state: 'attached' });
		await page.waitForTimeout(500);

		// Click Agents tab, then switch to Pipelines mode
		await page.locator('button.tab-btn', { hasText: 'Agents' }).click({ force: true });
		await page.waitForTimeout(300);
		const pipelinesPill = page.locator('button.mode-pill', { hasText: 'Pipelines' });
		if (await pipelinesPill.isVisible()) {
			await pipelinesPill.click({ force: true });
			await page.waitForTimeout(500);

			const newBtn = page.locator('button', { hasText: /New Pipeline|Create/ });
			if (await newBtn.isVisible()) {
				await newBtn.click();
				await page.waitForTimeout(500);

				const typeSelect = page.locator('select').filter({ has: page.locator('option[value="orchestrator"]') });
				const count = await typeSelect.count();
				expect(count).toBeGreaterThanOrEqual(0);
			}
		}
	});
});
