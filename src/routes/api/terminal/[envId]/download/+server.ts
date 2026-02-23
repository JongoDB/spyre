import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getConnection } from '$lib/server/ssh-pool';

export const GET: RequestHandler = async ({ params, url }) => {
	const { envId } = params;
	const filePath = url.searchParams.get('path');

	if (!filePath) {
		return json({ code: 'MISSING_PATH', message: 'Query parameter "path" is required.' }, { status: 400 });
	}

	try {
		const client = await getConnection(envId);

		const { buffer, filename } = await new Promise<{ buffer: Buffer; filename: string }>((resolve, reject) => {
			client.sftp((err, sftp) => {
				if (err) {
					reject(new Error(`SFTP session failed: ${err.message}`));
					return;
				}

				// Verify file exists
				sftp.stat(filePath, (statErr, stats) => {
					if (statErr) {
						sftp.end();
						reject(new Error(`File not found: ${filePath}`));
						return;
					}

					if (!stats.isFile()) {
						sftp.end();
						reject(new Error(`Not a regular file: ${filePath}`));
						return;
					}

					const chunks: Buffer[] = [];
					const readStream = sftp.createReadStream(filePath);

					readStream.on('data', (chunk: Buffer) => {
						chunks.push(chunk);
					});

					readStream.on('error', (readErr: Error) => {
						sftp.end();
						reject(new Error(`Read failed: ${readErr.message}`));
					});

					readStream.on('end', () => {
						sftp.end();
						const fname = filePath.split('/').pop() ?? 'download';
						resolve({ buffer: Buffer.concat(chunks), filename: fname });
					});
				});
			});
		});

		return new Response(buffer, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': String(buffer.length)
			}
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ code: 'DOWNLOAD_FAILED', message }, { status: 500 });
	}
};
