import { getConnection } from './ssh-pool';

// =============================================================================
// Output Extractor — Parse file paths from agent results & verify via SSH
// =============================================================================

/** Directories/patterns to skip as false positives */
const SKIP_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /\.npm\//,
  /\.cache\//,
  /\/proc\//,
  /\/sys\//,
  /\/dev\//,
  /\/tmp\/npm-/,
];

/** File extensions that indicate real output files (not internal/config) */
const OUTPUT_EXTENSIONS = new Set([
  // Documents
  'md', 'txt', 'pdf', 'html', 'htm', 'csv', 'json', 'xml', 'yaml', 'yml', 'toml',
  // Code
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'css', 'scss', 'less', 'svelte', 'vue', 'astro',
  // Config
  'env', 'conf', 'cfg', 'ini',
  // Data
  'sql', 'db', 'sqlite',
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico',
  // Archives
  'zip', 'tar', 'gz', 'tgz',
  // Other
  'sh', 'bash', 'dockerfile', 'lock',
]);

/**
 * Extract candidate file paths from agent result summaries.
 * Uses multiple patterns to find paths mentioned in text output.
 */
export function extractFilePaths(resultSummaries: string[], projectDir: string): string[] {
  const candidates = new Set<string>();

  for (const text of resultSummaries) {
    // Pattern 1: Absolute paths with extensions — /path/to/file.ext
    const absPathRegex = /(?:^|\s|['"`(])(\/[\w./-]+\.\w+)/gm;
    for (const match of text.matchAll(absPathRegex)) {
      candidates.add(match[1]);
    }

    // Pattern 2: Action keywords followed by paths
    // "created /path/to/file.ts", "wrote to ./output.md", etc.
    const actionRegex = /(?:created|wrote|saved|generated|built|output|producing|writing)\s+(?:to\s+)?['"`]?((?:\/|\.\/|\.\.\/)?[\w./-]+\.\w+)['"`]?/gi;
    for (const match of text.matchAll(actionRegex)) {
      candidates.add(match[1]);
    }

    // Pattern 3: Backtick-fenced paths — `src/foo.ts`
    const backtickRegex = /`((?:\/|\.\/|\.\.\/)?[\w./-]+\.\w+)`/g;
    for (const match of text.matchAll(backtickRegex)) {
      candidates.add(match[1]);
    }

    // Pattern 4: Relative paths starting with ./ or containing / with extension
    const relPathRegex = /(?:^|\s)(\.\/[\w./-]+\.\w+)/gm;
    for (const match of text.matchAll(relPathRegex)) {
      candidates.add(match[1]);
    }
  }

  // Resolve, filter, and deduplicate
  const resolved = new Set<string>();

  for (const raw of candidates) {
    let path = raw.trim();

    // Skip URLs
    if (path.startsWith('http://') || path.startsWith('https://')) continue;

    // Resolve relative paths against projectDir
    if (path.startsWith('./') || path.startsWith('../') || !path.startsWith('/')) {
      path = `${projectDir}/${path.replace(/^\.\//, '')}`;
    }

    // Normalize double slashes
    path = path.replace(/\/\//g, '/');

    // Skip known false-positive patterns
    if (SKIP_PATTERNS.some(re => re.test(path))) continue;

    // Check extension is in our known set
    const ext = path.split('.').pop()?.toLowerCase();
    if (!ext || !OUTPUT_EXTENSIONS.has(ext)) continue;

    resolved.add(path);
  }

  // Cap at 50 candidates to avoid SSH overload
  return [...resolved].slice(0, 50);
}

/**
 * Verify which candidate files actually exist on the remote environment.
 * Uses a single SSH exec with batched stat calls.
 */
export async function verifyFilesExist(
  envId: string,
  projectDir: string,
  paths: string[]
): Promise<Array<{ path: string; filename: string; size: number }>> {
  if (paths.length === 0) return [];

  const client = await getConnection(envId);

  // Build a batch stat command
  const escapedPaths = paths.map(p => `'${p.replace(/'/g, "'\\''")}'`);
  const cmd = `for f in ${escapedPaths.join(' ')}; do [ -f "$f" ] && stat --printf='%n\\t%s\\n' "$f" 2>/dev/null; done`;

  const output = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stat command timed out')), 15000);
    client.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); reject(err); return; }
      let stdout = '';
      stream.on('data', (d: Buffer) => { stdout += d.toString(); });
      stream.stderr.on('data', () => { /* consume */ });
      stream.on('close', () => { clearTimeout(timer); resolve(stdout); });
    });
  });

  const results: Array<{ path: string; filename: string; size: number }> = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [filePath, sizeStr] = trimmed.split('\t');
    if (!filePath || !sizeStr) continue;

    const size = parseInt(sizeStr, 10);
    if (isNaN(size)) continue;

    const filename = filePath.split('/').pop() ?? filePath;
    results.push({ path: filePath, filename, size });
  }

  return results;
}
