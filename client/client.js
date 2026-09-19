window.__ModuleLoader__.load({
	id: "dsh-fixes",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/catalog-groups.ts
		function groupCatalogByProvider(catalog, providerLabels = {}) {
			const groups = [];
			const index = /* @__PURE__ */ new Map();
			for (const entry of catalog) {
				let group = index.get(entry.provider);
				if (group === void 0) {
					const named = providerLabels[entry.provider];
					group = {
						provider: entry.provider,
						label: named && named.length > 0 ? named : entry.provider,
						models: []
					};
					index.set(entry.provider, group);
					groups.push(group);
				}
				group.models.push(entry);
			}
			return groups;
		}
		//#endregion
		//#region src/client/index.ts
		const name = "dsh-fixes";
		const inject = ["slots", "settingsScope"];
		const FIXES_NS = "dsh-fixes";
		const PI_AI_NS = "llm-pi-ai";
		const WINDOW_CHOICES = [
			{
				tokens: 1e5,
				label: "100k"
			},
			{
				tokens: 2e5,
				label: "200k"
			},
			{
				tokens: 5e5,
				label: "500k"
			},
			{
				tokens: 1e6,
				label: "1M"
			}
		];
		const DEFAULT_FIXES = {
			contextWindows: {},
			summarization: null,
			thresholdRatio: .4
		};
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function modelKey(provider, model) {
			return `${provider}/${model}`;
		}
		function clampThresholdRatio(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return .4;
			if (value < .2) return .2;
			if (value > .9) return .9;
			return value;
		}
		function parseFixesSettings(raw) {
			if (!isRecord(raw)) return {
				contextWindows: {},
				summarization: null,
				thresholdRatio: .4
			};
			const contextWindows = {};
			if (isRecord(raw.contextWindows)) {
				for (const [key, tokens] of Object.entries(raw.contextWindows)) if (typeof tokens === "number" && WINDOW_CHOICES.some((choice) => choice.tokens === tokens)) contextWindows[key] = tokens;
			}
			let summarization = null;
			if (isRecord(raw.summarization) && typeof raw.summarization.provider === "string" && typeof raw.summarization.model === "string") {
				if (raw.summarization.provider.length > 0 && raw.summarization.model.length > 0) summarization = {
					provider: raw.summarization.provider,
					model: raw.summarization.model
				};
			}
			return {
				contextWindows,
				summarization,
				thresholdRatio: clampThresholdRatio(raw.thresholdRatio)
			};
		}
		function windowLabel(tokens) {
			return WINDOW_CHOICES.find((choice) => choice.tokens === tokens)?.label ?? "";
		}
		function nearestWindowChoice(tokens) {
			let best = 1e5;
			let bestDelta = Infinity;
			for (const choice of WINDOW_CHOICES) {
				const delta = Math.abs(choice.tokens - tokens);
				if (delta < bestDelta) {
					best = choice.tokens;
					bestDelta = delta;
				}
			}
			return best;
		}
		function settingsBinder(ctx) {
			if (ctx.settingsScope !== void 0 && typeof ctx.settingsScope.bind === "function") return ctx.settingsScope;
			if (typeof ctx.get === "function") {
				const value = ctx.get("settingsScope");
				if (isRecord(value) && typeof value.bind === "function") return value;
			}
		}
		function catalogFromPiAi(raw) {
			if (!isRecord(raw) || !isRecord(raw.providers)) return [];
			const models = [];
			const seen = /* @__PURE__ */ new Set();
			for (const [provider, profile] of Object.entries(raw.providers)) {
				if (!isRecord(profile)) continue;
				const list = Array.isArray(profile.models) ? profile.models : [];
				for (const entry of list) {
					if (!isRecord(entry)) continue;
					const model = typeof entry.id === "string" ? entry.id : typeof entry.name === "string" ? entry.name : "";
					if (!model) continue;
					const key = modelKey(provider, model);
					if (seen.has(key)) continue;
					seen.add(key);
					const display = typeof entry.name === "string" && entry.name && entry.name !== model ? entry.name : model;
					models.push({
						provider,
						model,
						label: display
					});
				}
			}
			return models;
		}
		function providerLabelsFromPiAi(raw) {
			if (!isRecord(raw) || !isRecord(raw.providers)) return {};
			const labels = {};
			for (const [provider, profile] of Object.entries(raw.providers)) {
				if (!isRecord(profile)) continue;
				const named = typeof profile.displayName === "string" ? profile.displayName.trim() : "";
				labels[provider] = named.length > 0 ? named : provider;
			}
			return labels;
		}
		function finiteTokens(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : void 0;
		}
		function catalogContextWindow(raw, provider, model) {
			if (!isRecord(raw) || !isRecord(raw.providers)) return void 0;
			const profile = raw.providers[provider];
			if (!isRecord(profile)) return void 0;
			let tokens;
			if (Array.isArray(profile.models)) for (const entry of profile.models) {
				if (!isRecord(entry)) continue;
				if ((typeof entry.id === "string" ? entry.id : typeof entry.name === "string" ? entry.name : "") !== model) continue;
				const window = finiteTokens(entry.contextWindow);
				if (window !== void 0) tokens = window;
			}
			const overrides = profile.modelOverrides;
			if (isRecord(overrides) && isRecord(overrides[model])) {
				const window = finiteTokens(overrides[model].contextWindow);
				if (window !== void 0) tokens = window;
			}
			return tokens;
		}
		function selectedWindowTokens(stored, catalogTokens) {
			if (stored !== void 0) return stored;
			if (catalogTokens !== void 0) return nearestWindowChoice(catalogTokens);
		}
		function lookupCommandsRun(source) {
			if (!isRecord(source)) return void 0;
			const direct = source["commands/run"];
			if (typeof direct === "function") return direct.bind(source);
			const commands = source.commands;
			if (isRecord(commands) && typeof commands.run === "function") return commands.run.bind(commands);
		}
		function findCommandsRun(ctx, props) {
			const fromGet = typeof ctx.get === "function" ? ctx.get("commands") : void 0;
			const fromNamed = typeof ctx.get === "function" ? ctx.get("commands/run") : void 0;
			if (typeof fromNamed === "function") return fromNamed;
			return lookupCommandsRun(props) ?? lookupCommandsRun(ctx) ?? lookupCommandsRun(fromGet);
		}
		function compactErrorText(reason) {
			if (!(reason instanceof Error)) return String(reason);
			const generic = /could not produce|useful summary/i.test(reason.message);
			const cause = reason.cause instanceof Error ? reason.cause.message : typeof reason.cause === "string" ? reason.cause : void 0;
			if (generic && cause) return cause;
			return reason.message;
		}
		function resultErrorText(result) {
			if (!isRecord(result)) return "";
			if (result.ok === false && typeof result.error === "string") return result.error;
			if (result.kind === "error" && typeof result.text === "string") return result.text;
			if (isRecord(result.result) && result.result.kind === "error" && typeof result.result.text === "string") return result.result.text;
			return "";
		}
		function asRecord(value) {
			return isRecord(value) ? value : void 0;
		}
		function readModelPair(value) {
			const rec = asRecord(value);
			if (rec === void 0) return void 0;
			const provider = rec.provider;
			const model = rec.model;
			if (typeof provider === "string" && provider.length > 0 && typeof model === "string" && model.length > 0) return {
				provider,
				model
			};
		}
		function modelFromSelection(value) {
			const rec = asRecord(value);
			if (rec === void 0) return void 0;
			return readModelPair(rec.next) ?? readModelPair(rec.lastUsed);
		}
		function useScopeValue(scope, fallback) {
			return (0, react.useSyncExternalStore)((onStoreChange) => {
				if (scope === void 0) return () => void 0;
				return scope.subscribe(onStoreChange);
			}, () => scope?.getSnapshot().value ?? fallback, () => fallback);
		}
		const chipStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			height: 28,
			padding: "0 10px",
			border: "0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.35))",
			borderRadius: 8,
			background: "var(--dsw-alias-interactive-bg-idle, transparent)",
			color: "var(--dsw-alias-label-primary, inherit)",
			font: "inherit",
			fontSize: 12,
			lineHeight: "20px",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		const popoverStyle = {
			position: "absolute",
			bottom: "calc(100% + 8px)",
			left: 0,
			zIndex: 40,
			minWidth: 268,
			padding: 12,
			display: "flex",
			flexDirection: "column",
			gap: 12,
			borderRadius: 12,
			border: "0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,0.28))",
			background: "var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-1, #1c1c1c))",
			color: "var(--dsw-alias-label-primary, inherit)",
			boxShadow: "0 8px 24px rgba(0,0,0,0.28)"
		};
		const rowStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 6
		};
		const labelStyle = {
			fontSize: 12,
			fontWeight: 600,
			color: "var(--dsw-alias-label-secondary, inherit)"
		};
		const choiceRowStyle = {
			display: "flex",
			gap: 6
		};
		function choiceStyle(active, disabled) {
			return {
				flex: 1,
				height: 28,
				border: active ? "0.5px solid var(--dsw-alias-state-business-primary, #3b82f6)" : "0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.35))",
				borderRadius: 8,
				background: active ? "var(--dsw-alias-interactive-bg-selected, rgba(59,130,246,0.16))" : "transparent",
				color: "var(--dsw-alias-label-primary, inherit)",
				font: "inherit",
				fontSize: 12,
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? .5 : 1
			};
		}
		const selectStyle = {
			height: 30,
			borderRadius: 8,
			border: "0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.35))",
			background: "var(--dsw-alias-bg-layer-1, transparent)",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			padding: "0 8px"
		};
		const compactStyle = {
			height: 32,
			borderRadius: 8,
			border: "0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.35))",
			background: "var(--dsw-alias-button-secondary-fill, transparent)",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			cursor: "pointer"
		};
		const errorStyle = {
			fontSize: 11,
			color: "var(--dsw-alias-state-error-primary, #f87171)",
			margin: 0
		};
		function apply(ctx) {
			const binder = settingsBinder(ctx);
			const fixesScope = binder?.bind({
				namespace: FIXES_NS,
				decode: parseFixesSettings
			});
			const piAiScope = binder?.bind({ namespace: PI_AI_NS });
			function ContextPanel(props) {
				const current = modelFromSelection(typeof props.useProjection === "function" ? props.useProjection("modelSelection") : void 0);
				const running = typeof props.useSession === "function" ? props.useSession((value) => isRecord(value) && value.running === true) === true : false;
				const draft = typeof props.useInput === "function" ? String(props.useInput((value) => isRecord(value) && typeof value.draft === "string" ? value.draft : "") ?? "") : "";
				const fixes = useScopeValue(fixesScope, DEFAULT_FIXES);
				const piAi = useScopeValue(piAiScope, void 0);
				const catalogGroups = groupCatalogByProvider(catalogFromPiAi(piAi), providerLabelsFromPiAi(piAi));
				const [open, setOpen] = (0, react.useState)(false);
				const [error, setError] = (0, react.useState)("");
				const [compacting, setCompacting] = (0, react.useState)(false);
				const [draftPercent, setDraftPercent] = (0, react.useState)(null);
				const rootRef = (0, react.useRef)(null);
				const savedDraftRef = (0, react.useRef)(null);
				const sawRunningRef = (0, react.useRef)(false);
				const setDraftRef = (0, react.useRef)(props.inputActions?.setDraft);
				(0, react.useEffect)(() => {
					if (!open) return;
					const onPointer = (event) => {
						const root = rootRef.current;
						if (root !== null && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
					};
					document.addEventListener("pointerdown", onPointer);
					return () => document.removeEventListener("pointerdown", onPointer);
				}, [open]);
				(0, react.useEffect)(() => {
					setDraftRef.current = props.inputActions?.setDraft;
				}, [props.inputActions?.setDraft]);
				(0, react.useEffect)(() => {
					if (!compacting) {
						sawRunningRef.current = false;
						const saved = savedDraftRef.current;
						if (saved !== null) {
							savedDraftRef.current = null;
							try {
								setDraftRef.current?.(saved);
							} catch {}
						}
						return;
					}
					if (running) {
						sawRunningRef.current = true;
						const saved = savedDraftRef.current;
						if (saved !== null) {
							savedDraftRef.current = null;
							try {
								setDraftRef.current?.(saved);
							} catch {}
						}
						return;
					}
					if (sawRunningRef.current) {
						setCompacting(false);
						return;
					}
					const timer = globalThis.setTimeout(() => {
						setCompacting(false);
					}, 2e3);
					return () => globalThis.clearTimeout(timer);
				}, [compacting, running]);
				const selectedWindow = selectedWindowTokens(current === void 0 ? void 0 : fixes.contextWindows[modelKey(current.provider, current.model)], current === void 0 ? void 0 : catalogContextWindow(piAi, current.provider, current.model));
				const percent = draftPercent ?? Math.round(fixes.thresholdRatio * 100);
				const windowDisabled = current === void 0;
				const compactDisabled = running || compacting;
				const compactTitle = compacting ? "压缩进行中" : running ? "忙碌" : void 0;
				const chipWindow = windowLabel(selectedWindow);
				const persistField = (field, value) => {
					if (fixesScope === void 0) {
						setError("settings unavailable");
						return;
					}
					setError("");
					fixesScope.set(field, value).catch((reason) => {
						setError(reason instanceof Error ? reason.message : String(reason));
					});
				};
				const onWindow = (tokens) => {
					if (current === void 0) return;
					persistField("contextWindows", {
						...fixes.contextWindows,
						[modelKey(current.provider, current.model)]: tokens
					});
				};
				const onSummarizer = (value) => {
					if (value === "") {
						persistField("summarization", null);
						return;
					}
					const index = value.indexOf("/");
					if (index <= 0) return;
					persistField("summarization", {
						provider: value.slice(0, index),
						model: value.slice(index + 1)
					});
				};
				const commitThreshold = (raw) => {
					const next = Number(raw);
					setDraftPercent(null);
					if (!Number.isFinite(next)) return;
					persistField("thresholdRatio", next / 100);
				};
				const onCompact = () => {
					setError("");
					const run = findCommandsRun(ctx, props);
					if (typeof run === "function") {
						setCompacting(true);
						Promise.resolve(run("context-compact", props.sessionId)).then((result) => {
							const text = resultErrorText(result);
							if (text) {
								setError(text);
								setCompacting(false);
							}
						}).catch((reason) => {
							setError(compactErrorText(reason));
							setCompacting(false);
						});
						return;
					}
					const actions = props.inputActions;
					const setDraft = actions?.setDraft;
					const submit = actions?.submit;
					if (typeof setDraft !== "function" || typeof submit !== "function") {
						setError("请在输入框输入 /compact");
						return;
					}
					const saved = draft;
					savedDraftRef.current = saved;
					setCompacting(true);
					try {
						setDraft("/compact");
						submit();
					} catch (reason) {
						savedDraftRef.current = null;
						setError(compactErrorText(reason));
						setCompacting(false);
						try {
							setDraft(saved);
						} catch {}
						return;
					}
					globalThis.setTimeout(() => {
						const pending = savedDraftRef.current;
						if (pending === null) return;
						savedDraftRef.current = null;
						try {
							setDraft(pending);
						} catch {}
					}, 0);
				};
				const summarizerValue = fixes.summarization === null ? "" : modelKey(fixes.summarization.provider, fixes.summarization.model);
				return (0, react.createElement)("div", {
					ref: rootRef,
					style: {
						position: "relative",
						display: "inline-flex"
					}
				}, (0, react.createElement)("button", {
					type: "button",
					style: chipStyle,
					"aria-expanded": open,
					"aria-haspopup": "dialog",
					onClick: () => setOpen((value) => !value)
				}, chipWindow ? `上下文 ${chipWindow}` : "上下文"), open ? (0, react.createElement)("div", {
					role: "dialog",
					style: popoverStyle
				}, (0, react.createElement)("div", { style: rowStyle }, (0, react.createElement)("div", { style: labelStyle }, "上下文"), (0, react.createElement)("div", { style: choiceRowStyle }, ...WINDOW_CHOICES.map((choice) => (0, react.createElement)("button", {
					key: choice.label,
					type: "button",
					disabled: windowDisabled,
					title: windowDisabled ? "当前对话模型未知" : choice.label,
					style: choiceStyle(selectedWindow === choice.tokens, windowDisabled),
					onClick: () => onWindow(choice.tokens)
				}, choice.label)))), (0, react.createElement)("div", { style: rowStyle }, (0, react.createElement)("label", { style: labelStyle }, "压缩模型"), (0, react.createElement)("select", {
					style: selectStyle,
					value: summarizerValue,
					onChange: (event) => onSummarizer(event.target.value)
				}, (0, react.createElement)("option", { value: "" }, "当前对话模型"), ...catalogGroups.map((group) => (0, react.createElement)("optgroup", {
					key: group.provider,
					label: group.label
				}, ...group.models.map((entry) => (0, react.createElement)("option", {
					key: modelKey(entry.provider, entry.model),
					value: modelKey(entry.provider, entry.model)
				}, entry.label)))))), (0, react.createElement)("div", { style: rowStyle }, (0, react.createElement)("label", { style: labelStyle }, "自动压缩"), (0, react.createElement)("input", {
					type: "range",
					min: 20,
					max: 90,
					step: 5,
					value: percent,
					onChange: (event) => {
						setDraftPercent(Number(event.currentTarget.value));
					},
					onPointerUp: (event) => {
						commitThreshold(event.currentTarget.value);
					},
					onKeyUp: (event) => {
						commitThreshold(event.currentTarget.value);
					}
				}), (0, react.createElement)("div", { style: { fontSize: 12 } }, `用到 ${percent}% 时压缩`)), (0, react.createElement)("button", {
					type: "button",
					style: {
						...compactStyle,
						opacity: compactDisabled ? .55 : 1,
						cursor: compactDisabled ? "not-allowed" : "pointer"
					},
					disabled: compactDisabled,
					title: compactTitle,
					onClick: onCompact
				}, "压缩上下文"), error ? (0, react.createElement)("p", { style: errorStyle }, error) : null) : null);
			}
			ctx.slots.inject("conversation.input.left", function() {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "dsh-fixes-context",
					order: 0,
					label: "Context"
				}, function(props) {
					return (0, react.createElement)(ContextPanel, props);
				});
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map