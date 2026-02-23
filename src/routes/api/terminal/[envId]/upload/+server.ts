import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConnection } from '$lib/server/ssh-pool';

export const POST: RequestHandler = async ({ params, request }) => {
	const { envId } = params;

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ code: 'INVALID_REQUEST', message: 'Expected multipart/form-data.' }, { status: 400 });
	}

	const file = formData.get('file') as File | null;
	if (!file) {
		return json({ code: 'MISSING_FILE', message: 'No file provided.' }, { status: 400 });
	}

	const destPath = (formData.get('path') as string | null) || `/tmp/${file.name}`;

	try {
		const client = await getConnection(envId);
		const buffer = Buffer.from(await file.arrayBuffer());

		await new Promise<void>((resolve, reject) => {
			client.sftp((err, sftp) => {
				if (err) {
					reject(new Error(`SFTP session failed: ${err.message}`));
					return;
				}

				const writeStream = sftp.createWriteStream(destPath);

				writeStream.on('error', (writeErr: Error) => {
					sftp.end();
					reject(new Error(`Write failed: ${writeErr.message}`));
				});

				writeStream.on('close', () => {
					sftp.end();
					resolve();
				});

				writeStream.end(buffer);
			});
		});

		return json({ success: true, path: destPath, size: buffer.length });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ code: 'UPLOAD_FAILED', message }, { status: 500 });
	}
};
