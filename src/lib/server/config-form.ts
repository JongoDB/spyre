import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import type {
	SpyreConfig,
	SpyreConfigSpec,
	SpyreConfigPlatform,
	SpyreConfigResources,
	SpyreConfigNetwork,
	SpyreConfigProvision,
	SpyreConfigPackage,
	SpyreConfigScript,
	SpyreConfigService,
	SpyreConfigClaude,
	SpyreConfigLxc,
	SpyreConfigAccess
} from '$lib/types/yaml-config';

/**
 * Structured form data representation of a SpyreConfig.
 * Each section maps to a collapsible form section in the UI.
 */
export interface ConfigFormData {
	// Metadata
	name: string;
	kind: 'Environment' | 'EnvironmentBase';
	extends?: string;
	description?: string;
	labels: Record<string, string>;

	// Platform
	platformType: 'lxc' | 'vm';
	template?: string;
	cores?: number;
	memory?: number;
	swap?: number;
	disk?: number;
	storage?: string;

	// Network
	bridge?: string;
	ip?: string;
	gateway?: string;
	dns?: string;
	vlan?: number;

	// Software (software repo entry names)
	software: string[];

	// Community script
	communityScriptSlug?: string;
	communityScriptInstallMethod?: string;

	// Provision
	packages: string[];
	scripts: ConfigFormScript[];
	authorizedKeys: string[];

	// Services
	services: ConfigFormService[];

	// Claude
	claudeWorkingDirectory?: string;
	claudeMd?: string;

	// LXC
	unprivileged?: boolean;
	nesting?: boolean;
	features?: string;
	startupOrder?: number;
	protection?: boolean;

	// Access
	sshEnabled?: boolean;
	rootPassword?: string;
	defaultUser?: string;
	timezone?: string;

	// Helper script
	helperScript?: string;
}

export interface ConfigFormScript {
	name?: string;
	type: 'run' | 'copy' | 'url';
	content?: string;
	destination?: string;
	interpreter?: string;
	url?: string;
	postCommand?: string;
	mode?: string;
	owner?: string;
	condition?: string;
}

export interface ConfigFormService {
	name: string;
	port: number;
	protocol?: 'http' | 'https' | 'tcp';
}

/**
 * Convert a YAML text string into structured form data.
 */
export function yamlToFormData(yamlText: string): ConfigFormData {
	const parsed = parseYaml(yamlText) as Record<string, unknown>;
	if (!parsed || typeof parsed !== 'object') {
		throw { code: 'INVALID_CONFIG', message: 'YAML must be an object.' };
	}

	const metadata = (parsed.metadata ?? {}) as Record<string, unknown>;
	const spec = (parsed.spec ?? {}) as Record<string, unknown>;
	const platform = (spec.platform ?? {}) as Record<string, unknown>;
	const resources = (platform.resources ?? {}) as Record<string, unknown>;
	const network = (platform.network ?? {}) as Record<string, unknown>;
	const provision = (spec.provision ?? {}) as Record<string, unknown>;
	const claude = (spec.claude ?? {}) as Record<string, unknown>;
	const lxc = (spec.lxc ?? {}) as Record<string, unknown>;
	const access = (spec.access ?? {}) as Record<string, unknown>;
	const communityScript = (spec.community_script ?? {}) as Record<string, unknown>;

	// Parse packages (can be strings or objects)
	const rawPackages = (provision.packages ?? []) as Array<string | Record<string, unknown>>;
	const packages: string[] = [];
	for (const pkg of rawPackages) {
		if (typeof pkg === 'string') {
			packages.push(pkg);
		} else if (pkg && typeof pkg === 'object' && pkg.name) {
			packages.push(pkg.name as string);
		}
	}

	// Parse scripts
	const rawScripts = (provision.scripts ?? []) as Array<Record<string, unknown>>;
	const scripts: ConfigFormScript[] = rawScripts.map(s => {
		const copy = s.copy as Record<string, unknown> | undefined;
		let type: 'run' | 'copy' | 'url' = 'run';
		if (copy) type = 'copy';
		else if (s.url) type = 'url';

		return {
			name: s.name as string | undefined,
			type,
			content: type === 'copy' ? (copy?.content as string) : (s.run as string | undefined),
			destination: copy?.destination as string | undefined,
			interpreter: s.interpreter as string | undefined,
			url: s.url as string | undefined,
			postCommand: s.post_command as string | undefined,
			mode: s.mode as string | undefined,
			owner: s.owner as string | undefined,
			condition: s.condition as string | undefined,
		};
	});

	// Parse services
	const rawServices = (spec.services ?? []) as Array<Record<string, unknown>>;
	const services: ConfigFormService[] = rawServices.map(s => ({
		name: s.name as string,
		port: s.port as number,
		protocol: s.protocol as 'http' | 'https' | 'tcp' | undefined,
	}));

	return {
		name: (metadata.name as string) ?? '',
		kind: (parsed.kind as 'Environment' | 'EnvironmentBase') ?? 'Environment',
		extends: parsed.extends as string | undefined,
		description: metadata.description as string | undefined,
		labels: (metadata.labels as Record<string, string>) ?? {},

		platformType: (platform.type as 'lxc' | 'vm') ?? 'lxc',
		template: platform.template as string | undefined,
		cores: resources.cores as number | undefined,
		memory: resources.memory as number | undefined,
		swap: resources.swap as number | undefined,
		disk: resources.disk as number | undefined,
		storage: resources.storage as string | undefined,

		bridge: network.bridge as string | undefined,
		ip: network.ip as string | undefined,
		gateway: network.gateway as string | undefined,
		dns: network.dns as string | undefined,
		vlan: network.vlan as number | undefined,

		software: (spec.software as string[]) ?? [],

		communityScriptSlug: communityScript.slug as string | undefined,
		communityScriptInstallMethod: communityScript.install_method as string | undefined,

		packages,
		scripts,
		authorizedKeys: (provision.authorized_keys as string[]) ?? [],

		services,

		claudeWorkingDirectory: claude.working_directory as string | undefined,
		claudeMd: claude.claude_md as string | undefined,

		unprivileged: lxc.unprivileged as boolean | undefined,
		nesting: lxc.nesting as boolean | undefined,
		features: lxc.features as string | undefined,
		startupOrder: lxc.startup_order as number | undefined,
		protection: lxc.protection as boolean | undefined,

		sshEnabled: access.ssh_enabled as boolean | undefined,
		rootPassword: access.root_password as string | undefined,
		defaultUser: access.default_user as string | undefined,
		timezone: access.timezone as string | undefined,

		helperScript: spec.helper_script as string | undefined,
	};
}

/**
 * Convert structured form data to a YAML string.
 */
export function formDataToYaml(form: ConfigFormData): string {
	const config = formDataToConfig(form);
	return stringifyYaml(config, { indent: 2, lineWidth: 120 });
}

/**
 * Convert form data to a SpyreConfig object.
 */
function formDataToConfig(form: ConfigFormData): Record<string, unknown> {
	const config: Record<string, unknown> = {
		apiVersion: 'spyre/v1',
		kind: form.kind,
	};

	if (form.extends) {
		config.extends = form.extends;
	}

	// Metadata
	const metadata: Record<string, unknown> = { name: form.name };
	if (form.description) metadata.description = form.description;
	if (Object.keys(form.labels).length > 0) metadata.labels = form.labels;
	config.metadata = metadata;

	// Spec
	const spec: Record<string, unknown> = {};

	// Platform
	const platform: Record<string, unknown> = { type: form.platformType };
	if (form.template) platform.template = form.template;

	const resources: Record<string, unknown> = {};
	if (form.cores !== undefined) resources.cores = form.cores;
	if (form.memory !== undefined) resources.memory = form.memory;
	if (form.swap !== undefined) resources.swap = form.swap;
	if (form.disk !== undefined) resources.disk = form.disk;
	if (form.storage) resources.storage = form.storage;
	if (Object.keys(resources).length > 0) platform.resources = resources;

	const network: Record<string, unknown> = {};
	if (form.bridge) network.bridge = form.bridge;
	if (form.ip) network.ip = form.ip;
	if (form.gateway) network.gateway = form.gateway;
	if (form.dns) network.dns = form.dns;
	if (form.vlan !== undefined) network.vlan = form.vlan;
	if (Object.keys(network).length > 0) platform.network = network;

	spec.platform = platform;

	// Helper script
	if (form.helperScript) spec.helper_script = form.helperScript;

	// Software
	if (form.software.length > 0) spec.software = form.software;

	// Community script
	if (form.communityScriptSlug) {
		const cs: Record<string, unknown> = { slug: form.communityScriptSlug };
		if (form.communityScriptInstallMethod) cs.install_method = form.communityScriptInstallMethod;
		spec.community_script = cs;
	}

	// Provision
	const provision: Record<string, unknown> = {};
	if (form.packages.length > 0) provision.packages = form.packages;
	if (form.scripts.length > 0) {
		provision.scripts = form.scripts.map(s => {
			const script: Record<string, unknown> = {};
			if (s.name) script.name = s.name;
			if (s.type === 'copy' && s.content) {
				script.copy = {
					content: s.content,
					destination: s.destination ?? '/tmp/spyre-file',
				};
			} else if (s.type === 'url' && s.url) {
				script.url = s.url;
			} else if (s.content) {
				script.run = s.content;
			}
			if (s.interpreter) script.interpreter = s.interpreter;
			if (s.postCommand) script.post_command = s.postCommand;
			if (s.mode) script.mode = s.mode;
			if (s.owner) script.owner = s.owner;
			if (s.condition) script.condition = s.condition;
			return script;
		});
	}
	if (form.authorizedKeys.length > 0) provision.authorized_keys = form.authorizedKeys;
	if (Object.keys(provision).length > 0) spec.provision = provision;

	// Services
	if (form.services.length > 0) {
		spec.services = form.services.map(s => {
			const svc: Record<string, unknown> = { name: s.name, port: s.port };
			if (s.protocol) svc.protocol = s.protocol;
			return svc;
		});
	}

	// Claude
	const claude: Record<string, unknown> = {};
	if (form.claudeWorkingDirectory) claude.working_directory = form.claudeWorkingDirectory;
	if (form.claudeMd) claude.claude_md = form.claudeMd;
	if (Object.keys(claude).length > 0) spec.claude = claude;

	// LXC
	const lxc: Record<string, unknown> = {};
	if (form.unprivileged !== undefined) lxc.unprivileged = form.unprivileged;
	if (form.nesting !== undefined) lxc.nesting = form.nesting;
	if (form.features) lxc.features = form.features;
	if (form.startupOrder !== undefined) lxc.startup_order = form.startupOrder;
	if (form.protection !== undefined) lxc.protection = form.protection;
	if (Object.keys(lxc).length > 0) spec.lxc = lxc;

	// Access
	const access: Record<string, unknown> = {};
	if (form.sshEnabled !== undefined) access.ssh_enabled = form.sshEnabled;
	if (form.rootPassword) access.root_password = form.rootPassword;
	if (form.defaultUser) access.default_user = form.defaultUser;
	if (form.timezone) access.timezone = form.timezone;
	if (Object.keys(access).length > 0) spec.access = access;

	config.spec = spec;
	return config;
}
