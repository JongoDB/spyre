export interface SoftwareEntry {
	id: string;
	name: string;
	description: string | null;
	logo_url: string | null;
	os_families: string;
	tags: string | null;
	is_builtin: number;
	created_at: string;
	updated_at: string;
}

export interface SoftwareInstruction {
	id: string;
	software_id: string;
	os_family: 'apt' | 'apk' | 'dnf' | 'yum' | 'any';
	sort_order: number;
	item_type: 'package' | 'script' | 'file';
	content: string;
	destination: string | null;
	label: string | null;
	post_command: string | null;
	package_manager: string | null;
	interpreter: string | null;
	source_url: string | null;
	file_mode: string | null;
	file_owner: string | null;
	condition: string | null;
	created_at: string;
}

export interface SoftwareEntryWithInstructions extends SoftwareEntry {
	instructions: SoftwareInstruction[];
}

export interface SoftwareEntryWithCounts extends SoftwareEntry {
	instruction_count: number;
	usage_count: number;
}

export interface SoftwareEntryInput {
	name: string;
	description?: string | null;
	logo_url?: string | null;
	os_families?: string;
	tags?: string | null;
}

export interface SoftwareInstructionInput {
	os_family: 'apt' | 'apk' | 'dnf' | 'yum' | 'any';
	sort_order?: number;
	item_type: 'package' | 'script' | 'file';
	content: string;
	destination?: string | null;
	label?: string | null;
	post_command?: string | null;
	package_manager?: string | null;
	interpreter?: string | null;
	source_url?: string | null;
	file_mode?: string | null;
	file_owner?: string | null;
	condition?: string | null;
}
