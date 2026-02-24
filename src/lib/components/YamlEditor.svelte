<script lang="ts">
	import { onMount } from 'svelte';
	import type { ConfigValidationError } from '$lib/types/yaml-config';

	let {
		value = $bindable(''),
		errors = [] as ConfigValidationError[],
		readonly = false,
		onchange
	}: {
		value: string;
		errors?: ConfigValidationError[];
		readonly?: boolean;
		onchange?: (value: string) => void;
	} = $props();

	let container: HTMLDivElement;
	let editorView: import('@codemirror/view').EditorView | undefined;
	let mounted = false;

	onMount(async () => {
		const { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } = await import('@codemirror/view');
		const { EditorState } = await import('@codemirror/state');
		const { yaml } = await import('@codemirror/lang-yaml');
		const { oneDark } = await import('@codemirror/theme-one-dark');
		const { defaultKeymap, history, historyKeymap, indentWithTab } = await import('@codemirror/commands');
		const { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } = await import('@codemirror/language');
		const { lintGutter, setDiagnostics } = await import('@codemirror/lint');
		const { closeBrackets, closeBracketsKeymap } = await import('@codemirror/autocomplete');

		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				const newValue = update.state.doc.toString();
				value = newValue;
				onchange?.(newValue);
			}
		});

		const extensions = [
			lineNumbers(),
			highlightActiveLine(),
			highlightActiveLineGutter(),
			drawSelection(),
			bracketMatching(),
			foldGutter(),
			indentOnInput(),
			closeBrackets(),
			history(),
			lintGutter(),
			yaml(),
			oneDark,
			syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
			keymap.of([
				...defaultKeymap,
				...historyKeymap,
				...closeBracketsKeymap,
				indentWithTab,
			]),
			updateListener,
			EditorView.theme({
				'&': {
					fontSize: '13px',
					height: '100%',
				},
				'.cm-scroller': {
					fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', monospace",
					overflow: 'auto',
				},
				'.cm-gutters': {
					backgroundColor: 'transparent',
					border: 'none',
				},
			}),
		];

		if (readonly) {
			extensions.push(EditorState.readOnly.of(true));
		}

		editorView = new EditorView({
			state: EditorState.create({
				doc: value,
				extensions,
			}),
			parent: container,
		});

		mounted = true;

		return () => {
			editorView?.destroy();
		};
	});

	// Sync external value changes into editor
	$effect(() => {
		if (mounted && editorView) {
			const currentDoc = editorView.state.doc.toString();
			if (value !== currentDoc) {
				editorView.dispatch({
					changes: { from: 0, to: currentDoc.length, insert: value },
				});
			}
		}
	});

	// Sync errors as diagnostics
	$effect(() => {
		if (mounted && editorView) {
			void (async () => {
				const { setDiagnostics } = await import('@codemirror/lint');
				const diagnostics = errors
					.filter(e => e.line !== undefined)
					.map(e => {
						const line = editorView!.state.doc.line(Math.min(e.line!, editorView!.state.doc.lines));
						return {
							from: line.from,
							to: line.to,
							severity: 'error' as const,
							message: e.message,
						};
					});

				editorView!.dispatch(setDiagnostics(editorView!.state, diagnostics));
			})();
		}
	});
</script>

<div class="yaml-editor" bind:this={container}></div>

<style>
	.yaml-editor {
		height: 100%;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.yaml-editor :global(.cm-editor) {
		height: 100%;
	}

	.yaml-editor :global(.cm-focused) {
		outline: none;
	}
</style>
