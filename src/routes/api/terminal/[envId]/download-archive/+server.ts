import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getConnection } from '$lib/server/ssh-pool';

/**
 * GET /api/terminal/:envId/download-archive?path=/project
 *
 * Streams a tar.gz archive of the given directory from the remote environment.
 * Runs `tar czf - -C <dir> .` over SSH and pipes the output back as a download.
 * Excludes common heavyweight directories (node_modules, .git, __pycache__, etc.)
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const { envId } = params;
	const dirPath = url.searchParams.get('path');

	if (!dirPath) {
		return json({ code: 'MISSING_PATH', message: 'Query parameter "path" is required.' }, { status: 400 });
	}

	try {
		const client = await getConnection(envId);

		// Verify directory exists
		await new Promise<void>((resolve, reject) => {
			client.sftp((err, sftp) => {
				if (err) { reject(new Error(`SFTP session failed: ${err.message}`)); return; }
				sftp.stat(dirPath, (statErr, stats) => {
					sftp.end();
					if (statErr) { reject(new Error(`Path not found: ${dirPath}`)); return; }
					if (!stats.isDirectory()) { reject(new Error(`Not a directory: ${dirPath}`)); return; }
					resolve();
				});
			});
		});

		// Derive archive filename: prefer ?name= param, fall back to directory name
		const nameParam = url.searchParams.get('name');
		const dirName = nameParam || dirPath.split('/').filter(Boolean).pop() || 'project';

		// Build tar command excluding common heavyweight dirs
		const excludes = [
			'node_modules',
			'.git',
			'__pycache__',
			'.venv',
			'venv',
			'.next',
			'.nuxt',
			'dist',
			'.svelte-kit',
			'.cache',
			'target',       // Rust/Java builds
			'build',
		].map(e => `--exclude='${e}'`).join(' ');

		const cmd = `tar czf - -C '${dirPath.replace(/'/g, "'\\''")}' ${excludes} . 2>/dev/null`;

		// Stream tar output directly as a Response
		const { readable, writable } = new TransformStream<Uint8Array>();
		const writer = writable.getWriter();

		client.exec(cmd, (err, stream) => {
			if (err) {
				writer.abort(err);
				return;
			}

			stream.on('data', (chunk: Buffer) => {
				writer.write(new Uint8Array(chunk)).catch(() => { /* stream closed */ });
			});

			stream.stderr.on('data', () => { /* consume stderr */ });

			stream.on('close', () => {
				writer.close().catch(() => { /* already closed */ });
			});

			stream.on('error', (streamErr: Error) => {
				writer.abort(streamErr);
			});
		});

		return new Response(readable, {
			headers: {
				'Content-Type': 'application/gzip',
				'Content-Disposition': `attachment; filename="${dirName}.tar.gz"`,
				'Transfer-Encoding': 'chunked',
			}
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ code: 'ARCHIVE_FAILED', message }, { status: 500 });
	}
};
