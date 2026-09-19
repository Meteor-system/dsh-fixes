window.__ModuleLoader__.load({
	id: "dsh-fixes",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		const name = "dsh-fixes";
		const inject = ["slots"];
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
				...DEFAULT_FIXES,
				contextWindows: {}
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
		function readSettingsService(ctx) {
			if (ctx.settings !== void 0) return ctx.settings;
			if (typeof ctx.get === "function") {
				const settings = ctx.get("settings");
				if (isRecord(settings)) return settings;
			}
		}
		function settingsGet(ctx, namespace) {
			const settings = readSettingsService(ctx);
			if (typeof settings?.get === "function") try {
				return settings.get(namespace);
			} catch {
				return;
			}
		}
		function settingsUpdate(ctx, namespace, value) {
			const settings = readSettingsService(ctx);
			if (typeof settings?.update !== "function") return Promise.reject(/* @__PURE__ */ new Error("settings unavailable"));
			return Promise.resolve(settings.update(namespace, value)).then(() => void 0);
		}
		function asDisposer(value) {
			return typeof value === "function" ? () => {
				value();
			} : void 0;
		}
		function subscribeSettings(ctx, onChange) {
			const settings = readSettingsService(ctx);
			const disposers = [];
			if (typeof settings?.watch === "function") {
				const off = asDisposer(settings.watch(FIXES_NS, onChange));
				if (off !== void 0) disposers.push(off);
				const offPi = asDisposer(settings.watch(PI_AI_NS, onChange));
				if (offPi !== void 0) disposers.push(offPi);
			}
			if (typeof ctx.on === "function") {
				const off = asDisposer(ctx.on("settings/updated", (...args) => {
					const namespace = args[0];
					if (namespace === FIXES_NS || namespace === PI_AI_NS) onChange();
				}));
				if (off !== void 0) disposers.push(off);
			}
			return () => {
				for (const dispose of disposers) dispose();
			};
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
					const display = typeof entry.name === "string" && entry.name && entry.name !== model ? `${entry.name}` : model;
					models.push({
						provider,
						model,
						label: `${provider}/${display}`
					});
				}
			}
			return models;
		}
		function asRecord(value) {
			return isRecord(value) ? value : void 0;
		}
		function readModelPair(value) {
			const rec = asRecord(value);
			if (rec === void 0) return void 0;
			const nested = asRecord(rec.config) ?? asRecord(asRecord(rec.header)?.config) ?? asRecord(rec.header) ?? asRecord(rec.options) ?? asRecord(rec.requestConfig) ?? rec;
			const provider = nested.provider;
			const model = nested.model;
			if (typeof provider === "string" && provider.length > 0 && typeof model === "string" && model.length > 0) return {
				provider,
				model
			};
		}
		function walkForModel(value, depth = 0) {
			const direct = readModelPair(value);
			if (direct !== void 0) return direct;
			if (depth > 4) return void 0;
			const rec = asRecord(value);
			if (rec === void 0) return void 0;
			for (const key of [
				"config",
				"header",
				"prompt",
				"snapshot",
				"session",
				"options",
				"requestConfig",
				"lastRequest"
			]) {
				const found = walkForModel(rec[key], depth + 1);
				if (found !== void 0) return found;
			}
		}
		function currentModelFromSnapshots(session, conversation) {
			return walkForModel(session) ?? walkForModel(conversation);
		}
		function snapshotOf(hook) {
			if (typeof hook !== "function") return void 0;
			try {
				return hook((value) => value);
			} catch {
				try {
					return hook();
				} catch {
					return;
				}
			}
		}
		function sessionBusy(session) {
			const rec = asRecord(session);
			if (rec === void 0) return false;
			return rec.running === true || rec.status === "running" || rec.status === "busy";
		}
		function findRunCommand(props, chat) {
			if (typeof props.runCommand === "function") return props.runCommand.bind(props);
			if (typeof props.command === "function") return props.command.bind(props);
			const actions = props.inputActions;
			if (typeof actions?.runCommand === "function") return actions.runCommand.bind(actions);
			if (typeof actions?.submitCommand === "function") return actions.submitCommand.bind(actions);
			if (typeof chat?.runCommand === "function") return chat.runCommand.bind(chat);
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
			function ContextPanel(props) {
				const session = snapshotOf(props.useSession);
				const conversation = snapshotOf(props.useConversation);
				const chat = typeof props.useChat === "function" ? snapshotOf(props.useChat) : void 0;
				const current = currentModelFromSnapshots(session, conversation);
				const busy = sessionBusy(session);
				const [open, setOpen] = (0, react.useState)(false);
				const [fixes, setFixes] = (0, react.useState)(() => parseFixesSettings(settingsGet(ctx, FIXES_NS)));
				const [catalog, setCatalog] = (0, react.useState)(() => catalogFromPiAi(settingsGet(ctx, PI_AI_NS)));
				const [error, setError] = (0, react.useState)("");
				const [compacting, setCompacting] = (0, react.useState)(false);
				const [draftPercent, setDraftPercent] = (0, react.useState)(null);
				const rootRef = (0, react.useRef)(null);
				(0, react.useEffect)(() => {
					const pull = () => {
						setFixes(parseFixesSettings(settingsGet(ctx, FIXES_NS)));
						setCatalog(catalogFromPiAi(settingsGet(ctx, PI_AI_NS)));
					};
					pull();
					return subscribeSettings(ctx, pull);
				}, []);
				(0, react.useEffect)(() => {
					if (!open) return;
					const onPointer = (event) => {
						const root = rootRef.current;
						if (root !== null && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
					};
					document.addEventListener("pointerdown", onPointer);
					return () => document.removeEventListener("pointerdown", onPointer);
				}, [open]);
				const selectedWindow = (current === void 0 ? void 0 : fixes.contextWindows[modelKey(current.provider, current.model)]) ?? (current === void 0 ? void 0 : nearestWindowChoice(5e5));
				const percent = draftPercent ?? Math.round(fixes.thresholdRatio * 100);
				const windowDisabled = current === void 0;
				const compactDisabled = busy || compacting;
				const compactTitle = compacting ? "压缩进行中" : busy ? "忙碌" : void 0;
				const chipWindow = windowLabel(selectedWindow);
				const persist = (patch) => {
					const next = {
						contextWindows: patch.contextWindows ?? fixes.contextWindows,
						summarization: patch.summarization !== void 0 ? patch.summarization : fixes.summarization,
						thresholdRatio: patch.thresholdRatio ?? fixes.thresholdRatio
					};
					setFixes(next);
					settingsUpdate(ctx, FIXES_NS, next).catch((reason) => {
						setError(reason instanceof Error ? reason.message : String(reason));
					});
				};
				const onWindow = (tokens) => {
					if (current === void 0) return;
					persist({ contextWindows: {
						...fixes.contextWindows,
						[modelKey(current.provider, current.model)]: tokens
					} });
				};
				const onSummarizer = (value) => {
					if (value === "") {
						persist({ summarization: null });
						return;
					}
					const index = value.indexOf("/");
					if (index <= 0) return;
					persist({ summarization: {
						provider: value.slice(0, index),
						model: value.slice(index + 1)
					} });
				};
				const onCompact = () => {
					setError("");
					const run = findRunCommand(props, chat);
					if (run === void 0) {
						setError("请在输入框输入 /compact");
						return;
					}
					setCompacting(true);
					Promise.resolve(run("compact")).catch((reason) => {
						setError(reason instanceof Error ? reason.message : String(reason));
					}).finally(() => {
						setCompacting(false);
					});
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
				}, (0, react.createElement)("option", { value: "" }, "当前对话模型"), ...catalog.map((entry) => (0, react.createElement)("option", {
					key: modelKey(entry.provider, entry.model),
					value: modelKey(entry.provider, entry.model)
				}, entry.label)))), (0, react.createElement)("div", { style: rowStyle }, (0, react.createElement)("label", { style: labelStyle }, "自动压缩"), (0, react.createElement)("input", {
					type: "range",
					min: 20,
					max: 90,
					step: 5,
					value: percent,
					onChange: (event) => {
						const next = Number(event.target.value);
						setDraftPercent(next);
					},
					onPointerUp: () => {
						const next = draftPercent ?? percent;
						setDraftPercent(null);
						persist({ thresholdRatio: next / 100 });
					},
					onKeyUp: () => {
						const next = draftPercent ?? percent;
						setDraftPercent(null);
						persist({ thresholdRatio: next / 100 });
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