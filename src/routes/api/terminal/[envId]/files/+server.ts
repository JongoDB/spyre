import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConnection } from '$lib/server/ssh-pool';

interface FileEntry {
	name: string;
	isDir: boolean;
	size: number;
}

export const GET: RequestHandler = async ({ params, url }) => {
	const { envId } = params;
	let dirPath = url.searchParams.get('path') || '/';

	// Ensure path starts with /
	if (!dirPath.startsWith('/')) {
		dirPath = '/' + dirPath;
	}

	try {
		const client = await getConnection(envId);

		const entries = await new Promise<FileEntry[]>((resolve, reject) => {
			client.sftp((err, sftp) => {
				if (err) {
					reject(new Error(`SFTP session failed: ${err.message}`));
					return;
				}

				// First stat the path to check if it's a file
				sftp.stat(dirPath, (statErr, stats) => {
					if (statErr) {
						// Path doesn't exist — try parent directory
						const parent = dirPath.substring(0, dirPath.lastIndexOf('/')) || '/';
						readDirectory(sftp, parent, resolve, reject);
						return;
					}

					if (stats.isDirectory()) {
						readDirectory(sftp, dirPath, resolve, reject);
					} else {
						// It's a file — list its parent directory
						const parent = dirPath.substring(0, dirPath.lastIndexOf('/')) || '/';
						readDirectory(sftp, parent, resolve, reject);
					}
				});
			});
		});

		return json({ path: dirPath, entries });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ code: 'LIST_FAILED', message }, { status: 500 });
	}
};

function readDirectory(
	sftp: Parameters<Parameters<import('ssh2').Client['sftp']>[0]>[1],
	dirPath: string,
	resolve: (entries: FileEntry[]) => void,
	reject: (err: Error) => void
): void {
	sftp.readdir(dirPath, (readErr, list) => {
		sftp.end();

		if (readErr) {
			reject(new Error(`Failed to read directory: ${dirPath}`));
			return;
		}

		const entries: FileEntry[] = list
			.map((item) => ({
				name: item.filename,
				isDir: !!(item.attrs.mode && (item.attrs.mode & 0o40000)),
				size: item.attrs.size ?? 0,
			}))
			.filter((e) => e.name !== '.' && e.name !== '..')
			.sort((a, b) => {
				// Directories first, then alphabetical
				if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
				return a.name.localeCompare(b.name);
			});

		resolve(entries);
	});
}
