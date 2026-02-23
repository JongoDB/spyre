import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			out: 'build'
		}),
		csrf: {
			trustedOrigins: ['*']
		}
	}
};

export default config;
