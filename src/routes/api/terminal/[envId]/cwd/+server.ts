import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConnection } from '$lib/server/ssh-pool';
import { sshExec } from '$lib/server/tmux-controller';

export const GET: RequestHandler = async ({ params, url }) => {
	const { envId } = params;
	const windowIndex = url.searchParams.get('windowIndex') ?? '0';

	try {
		const client = await getConnection(envId);
		const result = await sshExec(
			client,
			`tmux display-message -t spyre:${windowIndex} -p '#{pane_current_path}'`
		);

		const cwd = result.stdout.trim();
		if (result.code !== 0 || !cwd) {
			return json({ cwd: '/tmp' });
		}

		return json({ cwd });
	} catch {
		return json({ cwd: '/tmp' });
	}
};
