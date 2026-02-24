import type { PageServerLoad } from './$types';
import { loadRawConfig, configExists } from '$lib/server/config-store';

const DEFAULT_CONFIG = `apiVersion: spyre/v1
kind: Environment
metadata:
  name: my-environment
  description: A new development environment

spec:
  platform:
    type: lxc
    template: local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst
    resources:
      cores: 2
      memory: 2048
      disk: 16
    network:
      ip: dhcp

  provision:
    packages:
      - curl
      - git
      - vim

  lxc:
    unprivileged: true
    nesting: true

  access:
    ssh_enabled: true
`;

export const load: PageServerLoad = async ({ url }) => {
	const name = url.searchParams.get('name');

	let content = DEFAULT_CONFIG;
	let isExisting = false;

	if (name && configExists(name)) {
		try {
			content = loadRawConfig(name);
			isExisting = true;
		} catch {
			// Fall back to default
		}
	}

	return {
		name: name ?? '',
		content,
		isExisting,
	};
};
