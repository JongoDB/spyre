import { describe, it, expect, vi } from 'vitest';
import {
	buildInstallCommand,
	generatePreview,
	executeSoftwarePoolItem,
	detectPackageManager,
} from './provisioner';
import type { ExecResult } from './provisioner';
import type { SoftwarePoolItem } from '$lib/types/template';

// =============================================================================
// Helpers
// =============================================================================

function mockExec(responses: ExecResult | ExecResult[] | ((cmd: string) => ExecResult)): (cmd: string, timeout?: number) => Promise<ExecResult> {
	if (typeof responses === 'function') {
		return async (cmd: string) => responses(cmd);
	}
	if (Array.isArray(responses)) {
		let i = 0;
		return async () => responses[i++] ?? { code: 0, stdout: '', stderr: '' };
	}
	return async () => responses;
}

function makeItem(overrides: Partial<SoftwarePoolItem> & { item_type: SoftwarePoolItem['item_type']; content: string }): SoftwarePoolItem {
	return {
		id: 'item-1',
		pool_id: 'pool-1',
		sort_order: 0,
		destination: null,
		label: null,
		post_command: null,
		package_manager: null,
		interpreter: null,
		source_url: null,
		file_mode: null,
		file_owner: null,
		condition: null,
		created_at: '2026-01-01T00:00:00Z',
		...overrides,
	};
}

// =============================================================================
// buildInstallCommand
// =============================================================================

describe('buildInstallCommand', () => {
	it('builds apt install command', () => {
		const cmd = buildInstallCommand('apt', 'git curl');
		expect(cmd).toContain('apt-get install -y -qq git curl');
		expect(cmd).toContain('apt-get update');
		expect(cmd).toContain('DEBIAN_FRONTEND=noninteractive');
	});

	it('builds apk install command', () => {
		const cmd = buildInstallCommand('apk', 'git curl');
		expect(cmd).toBe('apk add --no-cache git curl');
	});

	it('builds dnf install command', () => {
		const cmd = buildInstallCommand('dnf', 'git curl');
		expect(cmd).toBe('dnf install -y git curl');
	});

	it('builds yum install command', () => {
		const cmd = buildInstallCommand('yum', 'git curl');
		expect(cmd).toBe('yum install -y git curl');
	});
});

// =============================================================================
// detectPackageManager
// =============================================================================

describe('detectPackageManager', () => {
	it('detects apt when available', async () => {
		const exec = mockExec((cmd: string) => {
			if (cmd.includes('which apt')) return { code: 0, stdout: '/usr/bin/apt\n', stderr: '' };
			return { code: 1, stdout: '', stderr: '' };
		});
		expect(await detectPackageManager(exec)).toBe('apt');
	});

	it('detects apk when apt is not available', async () => {
		const exec = mockExec((cmd: string) => {
			if (cmd.includes('which apk')) return { code: 0, stdout: '/sbin/apk\n', stderr: '' };
			return { code: 1, stdout: '', stderr: '' };
		});
		expect(await detectPackageManager(exec)).toBe('apk');
	});

	it('returns null when no PM found', async () => {
		const exec = mockExec({ code: 1, stdout: '', stderr: '' });
		expect(await detectPackageManager(exec)).toBeNull();
	});
});

// =============================================================================
// generatePreview
// =============================================================================

describe('generatePreview', () => {
	it('generates package install preview with apt', () => {
		const items: SoftwarePoolItem[] = [
			makeItem({ item_type: 'package', content: 'git curl wget' }),
		];
		const commands = generatePreview(items, 'apt');
		expect(commands).toHaveLength(1);
		expect(commands[0].command).toContain('apt-get install');
		expect(commands[0].command).toContain('git curl wget');
	});

	it('marks PM-mismatched packages as skipped', () => {
		const items: SoftwarePoolItem[] = [
			makeItem({ item_type: 'package', content: 'git', package_manager: 'dnf' }),
		];
		const commands = generatePreview(items, 'apt');
		expect(commands[0].skipped).toBe(true);
		expect(commands[0].skip_reason).toContain('dnf');
	});

	it('generates script preview with interpreter', () => {
		const items: SoftwarePoolItem[] = [
			makeItem({ item_type: 'script', content: 'print("hello")', interpreter: 'python3', label: 'hello script' }),
		];
		const commands = generatePreview(items);
		expect(commands).toHaveLength(1);
		expect(commands[0].command).toContain('python3');
		expect(commands[0].label).toBe('hello script');
	});

	it('generates script preview from URL', () => {
		const items: SoftwarePoolItem[] = [
			makeItem({ item_type: 'script', content: '', source_url: 'https://example.com/setup.sh' }),
		];
		const commands = generatePreview(items);
		expect(commands[0].command).toContain('curl -fsSL');
		expect(commands[0].command).toContain('https://example.com/setup.sh');
	});

	it('generates file copy preview with permissions', () => {
		const items: SoftwarePoolItem[] = [
			makeItem({
				item_type: 'file',
				content: 'server {}',
				destination: '/etc/nginx/conf.d/app.conf',
				file_mode: '644',
				file_owner: 'root:root',
			}),
		];
		const commands = generatePreview(items);
		expect(commands[0].command).toContain('/etc/nginx/conf.d/app.conf');
		expect(commands[0].command).toContain('chmod 644');
		expect(commands[0].command).toContain('chown root:root');
	});

	it('includes condition note in preview', () => {
		const items: SoftwarePoolItem[] = [
			makeItem({ item_type: 'package', content: 'docker-ce', condition: 'which docker' }),
		];
		const commands = generatePreview(items);
		expect(commands[0].command).toContain('# Condition: which docker must exit 0');
	});

	it('includes post_command in preview', () => {
		const items: SoftwarePoolItem[] = [
			makeItem({ item_type: 'package', content: 'nginx', post_command: 'systemctl enable nginx' }),
		];
		const commands = generatePreview(items, 'apt');
		expect(commands[0].command).toContain('systemctl enable nginx');
	});
});

// =============================================================================
// executeSoftwarePoolItem
// =============================================================================

describe('executeSoftwarePoolItem', () => {
	it('installs packages with auto-detected PM', async () => {
		const commands: string[] = [];
		const exec = mockExec((cmd: string) => {
			commands.push(cmd);
			if (cmd.includes('which apt')) return { code: 0, stdout: '/usr/bin/apt\n', stderr: '' };
			return { code: 0, stdout: '', stderr: '' };
		});

		const item = makeItem({ item_type: 'package', content: 'git curl', label: 'Dev tools' });
		await executeSoftwarePoolItem(exec, item);

		const installCmd = commands.find(c => c.includes('apt-get install'));
		expect(installCmd).toBeDefined();
		expect(installCmd).toContain('git curl');
	});

	it('installs packages with specified PM when matching', async () => {
		const commands: string[] = [];
		const exec = mockExec((cmd: string) => {
			commands.push(cmd);
			if (cmd.includes('which apt')) return { code: 0, stdout: '/usr/bin/apt\n', stderr: '' };
			return { code: 0, stdout: '', stderr: '' };
		});

		const item = makeItem({ item_type: 'package', content: 'git', package_manager: 'apt' });
		await executeSoftwarePoolItem(exec, item);

		expect(commands.some(c => c.includes('apt-get install'))).toBe(true);
	});

	it('skips package install when specified PM does not match', async () => {
		const events: { status: string; message: string }[] = [];
		const exec = mockExec((cmd: string) => {
			if (cmd.includes('which')) return { code: 0, stdout: '/usr/bin/apt\n', stderr: '' };
			return { code: 0, stdout: '', stderr: '' };
		});

		// Only `which apt` returns 0, but we specify dnf
		const execForPm = mockExec((cmd: string) => {
			if (cmd.includes('which apt')) return { code: 0, stdout: '/usr/bin/apt\n', stderr: '' };
			return { code: 1, stdout: '', stderr: '' };
		});

		const item = makeItem({ item_type: 'package', content: 'git', package_manager: 'dnf' });
		await executeSoftwarePoolItem(execForPm, item, (event) => {
			events.push({ status: event.status, message: event.message });
		});

		expect(events.some(e => e.status === 'skipped')).toBe(true);
	});

	it('executes script with bash interpreter', async () => {
		const commands: string[] = [];
		const exec = mockExec((cmd: string) => {
			commands.push(cmd);
			return { code: 0, stdout: '', stderr: '' };
		});

		const item = makeItem({ item_type: 'script', content: 'echo hello', label: 'Hello script' });
		await executeSoftwarePoolItem(exec, item);

		// Should write to temp file and execute with bash
		expect(commands.some(c => c.includes('cat >'))).toBe(true);
		expect(commands.some(c => c.includes('bash'))).toBe(true);
	});

	it('executes script from URL with interpreter', async () => {
		const commands: string[] = [];
		const exec = mockExec((cmd: string) => {
			commands.push(cmd);
			return { code: 0, stdout: '', stderr: '' };
		});

		const item = makeItem({
			item_type: 'script',
			content: '',
			source_url: 'https://example.com/install.sh',
			interpreter: 'sh',
			label: 'Remote script',
		});
		await executeSoftwarePoolItem(exec, item);

		expect(commands.some(c => c.includes('curl -fsSL') && c.includes('| sh'))).toBe(true);
	});

	it('copies file with permissions', async () => {
		const commands: string[] = [];
		const exec = mockExec((cmd: string) => {
			commands.push(cmd);
			return { code: 0, stdout: '', stderr: '' };
		});

		const item = makeItem({
			item_type: 'file',
			content: 'Hello World',
			destination: '/etc/motd',
			file_mode: '644',
			file_owner: 'root:root',
			label: 'MOTD file',
		});
		await executeSoftwarePoolItem(exec, item);

		expect(commands.some(c => c.includes('/etc/motd'))).toBe(true);
		expect(commands.some(c => c.includes('chmod 644'))).toBe(true);
		expect(commands.some(c => c.includes('chown root:root'))).toBe(true);
	});

	it('skips item when condition fails', async () => {
		const commands: string[] = [];
		const events: { status: string }[] = [];
		const exec = mockExec((cmd: string) => {
			commands.push(cmd);
			if (cmd === 'test -f /opt/skip-this') return { code: 1, stdout: '', stderr: '' };
			return { code: 0, stdout: '', stderr: '' };
		});

		const item = makeItem({
			item_type: 'package',
			content: 'some-pkg',
			condition: 'test -f /opt/skip-this',
		});
		await executeSoftwarePoolItem(exec, item, (event) => {
			events.push({ status: event.status });
		});

		expect(events.some(e => e.status === 'skipped')).toBe(true);
		// Should not have tried to install packages
		expect(commands.some(c => c.includes('apt-get install') || c.includes('which apt'))).toBe(false);
	});

	it('runs item when condition passes', async () => {
		const commands: string[] = [];
		const exec = mockExec((cmd: string) => {
			commands.push(cmd);
			if (cmd === 'test -f /opt/proceed') return { code: 0, stdout: '', stderr: '' };
			if (cmd.includes('which apt')) return { code: 0, stdout: '/usr/bin/apt\n', stderr: '' };
			return { code: 0, stdout: '', stderr: '' };
		});

		const item = makeItem({
			item_type: 'package',
			content: 'special-pkg',
			condition: 'test -f /opt/proceed',
		});
		await executeSoftwarePoolItem(exec, item);

		expect(commands.some(c => c.includes('apt-get install'))).toBe(true);
	});

	it('emits per-item events', async () => {
		const events: { phase: string; status: string; message: string }[] = [];
		const exec = mockExec((cmd: string) => {
			if (cmd.includes('which apt')) return { code: 0, stdout: '/usr/bin/apt\n', stderr: '' };
			return { code: 0, stdout: '', stderr: '' };
		});

		const item = makeItem({ item_type: 'package', content: 'vim', label: 'Editor' });
		await executeSoftwarePoolItem(exec, item, (event) => {
			events.push(event);
		});

		expect(events.length).toBeGreaterThanOrEqual(2);
		expect(events[0].status).toBe('running');
		expect(events[0].message).toContain('Editor');
		expect(events[events.length - 1].status).toBe('success');
	});

	it('runs post_command after successful item', async () => {
		const commands: string[] = [];
		const exec = mockExec((cmd: string) => {
			commands.push(cmd);
			if (cmd.includes('which apt')) return { code: 0, stdout: '/usr/bin/apt\n', stderr: '' };
			return { code: 0, stdout: '', stderr: '' };
		});

		const item = makeItem({
			item_type: 'package',
			content: 'nginx',
			post_command: 'systemctl enable nginx',
		});
		await executeSoftwarePoolItem(exec, item);

		expect(commands.some(c => c === 'systemctl enable nginx')).toBe(true);
	});
});
