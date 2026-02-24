import { v4 as uuid } from 'uuid';
import { getDb } from './db';

interface SeedEntry {
	name: string;
	description: string;
	os_families: string;
	tags: string;
	instructions: Array<{
		os_family: string;
		item_type: 'package' | 'script';
		content: string;
		label?: string;
		post_command?: string;
	}>;
}

const SEED_DATA: SeedEntry[] = [
	{
		name: 'git',
		description: 'Distributed version control system',
		os_families: 'apt,apk,dnf,yum',
		tags: 'dev,vcs',
		instructions: [
			{ os_family: 'apt', item_type: 'package', content: 'git', label: 'Install git' },
			{ os_family: 'apk', item_type: 'package', content: 'git', label: 'Install git' },
			{ os_family: 'dnf', item_type: 'package', content: 'git', label: 'Install git' },
			{ os_family: 'yum', item_type: 'package', content: 'git', label: 'Install git' }
		]
	},
	{
		name: 'curl',
		description: 'Command-line tool for transferring data with URLs',
		os_families: 'apt,apk,dnf,yum',
		tags: 'networking,tools',
		instructions: [
			{ os_family: 'apt', item_type: 'package', content: 'curl', label: 'Install curl' },
			{ os_family: 'apk', item_type: 'package', content: 'curl', label: 'Install curl' },
			{ os_family: 'dnf', item_type: 'package', content: 'curl', label: 'Install curl' },
			{ os_family: 'yum', item_type: 'package', content: 'curl', label: 'Install curl' }
		]
	},
	{
		name: 'vim',
		description: 'Highly configurable text editor',
		os_families: 'apt,apk,dnf,yum',
		tags: 'editor,tools',
		instructions: [
			{ os_family: 'apt', item_type: 'package', content: 'vim', label: 'Install vim' },
			{ os_family: 'apk', item_type: 'package', content: 'vim', label: 'Install vim' },
			{ os_family: 'dnf', item_type: 'package', content: 'vim-enhanced', label: 'Install vim' },
			{ os_family: 'yum', item_type: 'package', content: 'vim-enhanced', label: 'Install vim' }
		]
	},
	{
		name: 'Node.js',
		description: 'JavaScript runtime built on Chrome\'s V8 engine',
		os_families: 'apt,apk,dnf,yum',
		tags: 'dev,runtime,javascript',
		instructions: [
			{ os_family: 'apt', item_type: 'script', content: 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -\napt-get install -y nodejs', label: 'Install Node.js 22 via NodeSource' },
			{ os_family: 'apk', item_type: 'package', content: 'nodejs npm', label: 'Install Node.js' },
			{ os_family: 'dnf', item_type: 'script', content: 'curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -\ndnf install -y nodejs', label: 'Install Node.js 22 via NodeSource' },
			{ os_family: 'yum', item_type: 'script', content: 'curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -\nyum install -y nodejs', label: 'Install Node.js 22 via NodeSource' }
		]
	},
	{
		name: 'Python 3',
		description: 'Python programming language interpreter',
		os_families: 'apt,apk,dnf,yum',
		tags: 'dev,runtime,python',
		instructions: [
			{ os_family: 'apt', item_type: 'package', content: 'python3 python3-pip python3-venv', label: 'Install Python 3 + pip + venv' },
			{ os_family: 'apk', item_type: 'package', content: 'python3 py3-pip', label: 'Install Python 3 + pip' },
			{ os_family: 'dnf', item_type: 'package', content: 'python3 python3-pip', label: 'Install Python 3 + pip' },
			{ os_family: 'yum', item_type: 'package', content: 'python3 python3-pip', label: 'Install Python 3 + pip' }
		]
	},
	{
		name: 'Docker',
		description: 'Container runtime and orchestration platform',
		os_families: 'apt,dnf',
		tags: 'containers,dev,ops',
		instructions: [
			{ os_family: 'apt', item_type: 'script', content: 'curl -fsSL https://get.docker.com | sh', label: 'Install Docker via convenience script' },
			{ os_family: 'dnf', item_type: 'script', content: 'curl -fsSL https://get.docker.com | sh', label: 'Install Docker via convenience script' }
		]
	},
	{
		name: 'build-essential',
		description: 'C/C++ compiler and essential build tools',
		os_families: 'apt,apk,dnf,yum',
		tags: 'dev,build',
		instructions: [
			{ os_family: 'apt', item_type: 'package', content: 'build-essential', label: 'Install build-essential' },
			{ os_family: 'apk', item_type: 'package', content: 'build-base', label: 'Install build-base' },
			{ os_family: 'dnf', item_type: 'script', content: 'dnf groupinstall -y "Development Tools"', label: 'Install Development Tools group' },
			{ os_family: 'yum', item_type: 'script', content: 'yum groupinstall -y "Development Tools"', label: 'Install Development Tools group' }
		]
	},
	{
		name: 'nginx',
		description: 'High-performance HTTP server and reverse proxy',
		os_families: 'apt,apk,dnf,yum',
		tags: 'web,server',
		instructions: [
			{ os_family: 'apt', item_type: 'package', content: 'nginx', label: 'Install nginx', post_command: 'systemctl enable nginx && systemctl start nginx' },
			{ os_family: 'apk', item_type: 'package', content: 'nginx', label: 'Install nginx', post_command: 'rc-update add nginx && rc-service nginx start' },
			{ os_family: 'dnf', item_type: 'package', content: 'nginx', label: 'Install nginx', post_command: 'systemctl enable nginx && systemctl start nginx' },
			{ os_family: 'yum', item_type: 'package', content: 'nginx', label: 'Install nginx', post_command: 'systemctl enable nginx && systemctl start nginx' }
		]
	},
	{
		name: 'wget',
		description: 'Non-interactive network downloader',
		os_families: 'apt,apk,dnf,yum',
		tags: 'networking,tools',
		instructions: [
			{ os_family: 'apt', item_type: 'package', content: 'wget', label: 'Install wget' },
			{ os_family: 'apk', item_type: 'package', content: 'wget', label: 'Install wget' },
			{ os_family: 'dnf', item_type: 'package', content: 'wget', label: 'Install wget' },
			{ os_family: 'yum', item_type: 'package', content: 'wget', label: 'Install wget' }
		]
	},
	{
		name: 'htop',
		description: 'Interactive process viewer',
		os_families: 'apt,apk,dnf,yum',
		tags: 'monitoring,tools',
		instructions: [
			{ os_family: 'apt', item_type: 'package', content: 'htop', label: 'Install htop' },
			{ os_family: 'apk', item_type: 'package', content: 'htop', label: 'Install htop' },
			{ os_family: 'dnf', item_type: 'package', content: 'htop', label: 'Install htop' },
			{ os_family: 'yum', item_type: 'package', content: 'htop', label: 'Install htop' }
		]
	},
	{
		name: 'jq',
		description: 'Lightweight command-line JSON processor',
		os_families: 'apt,apk,dnf,yum',
		tags: 'tools,json',
		instructions: [
			{ os_family: 'apt', item_type: 'package', content: 'jq', label: 'Install jq' },
			{ os_family: 'apk', item_type: 'package', content: 'jq', label: 'Install jq' },
			{ os_family: 'dnf', item_type: 'package', content: 'jq', label: 'Install jq' },
			{ os_family: 'yum', item_type: 'package', content: 'jq', label: 'Install jq' }
		]
	},
	{
		name: 'Go',
		description: 'Go programming language',
		os_families: 'apt,apk,dnf,yum',
		tags: 'dev,runtime,go',
		instructions: [
			{ os_family: 'any', item_type: 'script', content: 'curl -fsSL https://go.dev/dl/go1.22.5.linux-amd64.tar.gz | tar -C /usr/local -xzf -\necho \'export PATH=$PATH:/usr/local/go/bin\' >> /etc/profile.d/go.sh', label: 'Install Go 1.22' }
		]
	}
];

/**
 * Seed the software_repo table with built-in entries.
 * Safe to call multiple times — skips entries that already exist.
 */
export function seedSoftwareRepo(): void {
	const db = getDb();

	const existingCount = (db.prepare('SELECT COUNT(*) as count FROM software_repo WHERE is_builtin = 1').get() as { count: number }).count;
	if (existingCount >= SEED_DATA.length) {
		return; // Already seeded
	}

	const insertEntry = db.prepare(`
		INSERT OR IGNORE INTO software_repo (id, name, description, logo_url, os_families, tags, is_builtin)
		VALUES (?, ?, ?, ?, ?, ?, 1)
	`);

	const insertInstruction = db.prepare(`
		INSERT INTO software_repo_instructions (id, software_id, os_family, sort_order, item_type, content, destination, label, post_command, package_manager, interpreter, source_url, file_mode, file_owner, condition)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	db.transaction(() => {
		for (const entry of SEED_DATA) {
			const existing = db.prepare('SELECT id FROM software_repo WHERE name = ?').get(entry.name) as { id: string } | undefined;
			if (existing) continue;

			const id = uuid();
			insertEntry.run(id, entry.name, entry.description, null, entry.os_families, entry.tags);

			for (let i = 0; i < entry.instructions.length; i++) {
				const inst = entry.instructions[i];
				insertInstruction.run(
					uuid(), id, inst.os_family, i,
					inst.item_type, inst.content, null,
					inst.label ?? null, inst.post_command ?? null,
					null, null, null, null, null, null
				);
			}
		}
	})();

	console.log('[spyre] Software repo seeded with built-in entries');
}
