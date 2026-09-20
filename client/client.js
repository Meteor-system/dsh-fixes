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
		//#region src/compact-preview.ts
		const EMPTY_LINE = "没有可压缩的较早消息";
		const EXCERPT_LIMIT = 80;
		function isRecord$2(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function previewCompactDrop(nodes) {
			const firstIdx = nodes[0]?.type === "system/message" ? 1 : 0;
			const keepFromIdx = nodes.length - 1;
			if (keepFromIdx <= firstIdx) return {
				count: 0,
				dropped: [],
				line: EMPTY_LINE
			};
			const dropped = nodes.slice(firstIdx, keepFromIdx);
			return {
				count: dropped.length,
				dropped,
				line: `将压缩 ${dropped.length} 条较早消息`
			};
		}
		function clipExcerpt(text) {
			const trimmed = text.replace(/\s+/g, " ").trim();
			if (trimmed.length <= EXCERPT_LIMIT) return trimmed;
			return trimmed.slice(0, EXCERPT_LIMIT);
		}
		function eventText(event) {
			if (!isRecord$2(event)) return "";
			const data = isRecord$2(event.data) ? event.data : event;
			if (typeof data.text === "string") return data.text;
			if (typeof data.content === "string") return data.content;
			return "";
		}
		function eventTitle(type) {
			if (type === "system/message") return "系统";
			if (type === "user/message") return "用户";
			if (type === "assistant/message") return "助手";
			if (type === "tool/result" || type === "tool/call") return "工具";
			return type;
		}
		function roleToType(role) {
			if (role === "system") return "system/message";
			if (role === "user") return "user/message";
			if (role === "assistant") return "assistant/message";
			if (role === "tool") return "tool/result";
			return role;
		}
		function nodesFromMessages(messages) {
			if (!Array.isArray(messages)) return [];
			const result = [];
			for (const [index, message] of messages.entries()) {
				if (!isRecord$2(message)) continue;
				const role = typeof message.role === "string" ? message.role : "user";
				const type = role.includes("/") ? role : roleToType(role);
				result.push({
					seq: typeof message.seq === "number" ? message.seq : index,
					type,
					title: eventTitle(type),
					excerpt: clipExcerpt(eventText(message))
				});
			}
			return result;
		}
		function compactPreviewNodesFromSession(session) {
			if (!isRecord$2(session)) return [];
			const surface = isRecord$2(session.surface) ? session.surface : void 0;
			const nodes = Array.isArray(surface?.nodes) ? surface.nodes : void 0;
			const eventAt = typeof session.eventAt === "function" ? session.eventAt : void 0;
			if (nodes !== void 0 && eventAt !== void 0) {
				const result = [];
				for (const seqValue of nodes) {
					if (typeof seqValue !== "number") continue;
					const event = eventAt.call(session, seqValue);
					const type = isRecord$2(event) && typeof event.type === "string" ? event.type : "unknown";
					result.push({
						seq: seqValue,
						type,
						title: eventTitle(type),
						excerpt: clipExcerpt(eventText(event))
					});
				}
				return result;
			}
			return nodesFromMessages(session.messages);
		}
		function sessionIdOf(value) {
			if (typeof value === "string" && value.length > 0) return value;
			if (!isRecord$2(value)) return void 0;
			if (typeof value.id === "string" && value.id.length > 0) return value.id;
			if (typeof value.sessionId === "string" && value.sessionId.length > 0) return value.sessionId;
		}
		//#endregion
		//#region src/context-panel-ui.ts
		const WINDOW_LABELS = {
			1e5: "100k",
			2e5: "200k",
			5e5: "500k",
			1e6: "1M"
		};
		function windowSurchargeNote(tokens) {
			return tokens === 1e6 ? "1M 在部分模型上会额外计费" : null;
		}
		function contextChipCopy(tokens) {
			const window = tokens === void 0 ? void 0 : WINDOW_LABELS[tokens];
			if (window === void 0) return {
				label: "上下文",
				title: "上下文"
			};
			return {
				label: window,
				title: `上下文 ${window}`
			};
		}
		function compactButtonStyle(state) {
			return {
				background: state.pressed ? "var(--dsw-alias-state-business-primary-active, #1d4ed8)" : "var(--dsw-alias-state-business-primary, #3b82f6)",
				color: "#fff",
				opacity: state.busy ? .72 : 1,
				cursor: state.busy ? "wait" : "pointer"
			};
		}
		//#endregion
		//#region src/fixes-settings.ts
		const WINDOW_CHOICES$1 = [
			1e5,
			2e5,
			5e5,
			1e6
		];
		function clampThresholdRatio(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return .4;
			if (value < .2) return .2;
			if (value > .9) return .9;
			return value;
		}
		function nearestWindowChoice(tokens) {
			let best = 1e5;
			let bestDelta = Infinity;
			for (const choice of WINDOW_CHOICES$1) {
				const delta = Math.abs(choice - tokens);
				if (delta < bestDelta) {
					best = choice;
					bestDelta = delta;
				}
			}
			return best;
		}
		function isRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function parseSessionOverride(value) {
			if (!isRecord$1(value)) return void 0;
			const override = {};
			if (typeof value.window === "number" && WINDOW_CHOICES$1.includes(value.window)) override.window = value.window;
			if (typeof value.autoCompactEnabled === "boolean") override.autoCompactEnabled = value.autoCompactEnabled;
			return override.window !== void 0 || override.autoCompactEnabled !== void 0 ? override : void 0;
		}
		function parseFixesSettings(raw) {
			if (!isRecord$1(raw)) return {
				contextWindows: {},
				summarization: null,
				thresholdRatio: .4,
				autoCompactEnabled: true,
				sessionOverrides: {}
			};
			const contextWindows = {};
			if (isRecord$1(raw.contextWindows)) {
				for (const [key, tokens] of Object.entries(raw.contextWindows)) if (typeof tokens === "number" && WINDOW_CHOICES$1.includes(tokens)) contextWindows[key] = tokens;
			}
			let summarization = null;
			if (isRecord$1(raw.summarization) && typeof raw.summarization.provider === "string" && typeof raw.summarization.model === "string") {
				if (raw.summarization.provider.length > 0 && raw.summarization.model.length > 0) summarization = {
					provider: raw.summarization.provider,
					model: raw.summarization.model
				};
			}
			const sessionOverrides = {};
			if (isRecord$1(raw.sessionOverrides)) for (const [sessionId, value] of Object.entries(raw.sessionOverrides)) {
				if (sessionId.length === 0) continue;
				const override = parseSessionOverride(value);
				if (override !== void 0) sessionOverrides[sessionId] = override;
			}
			return {
				contextWindows,
				summarization,
				thresholdRatio: clampThresholdRatio(raw.thresholdRatio),
				autoCompactEnabled: raw.autoCompactEnabled !== false,
				sessionOverrides
			};
		}
		function resolveEffectiveWindow(fixes, sessionId, key) {
			if (sessionId !== void 0) {
				const window = fixes.sessionOverrides[sessionId]?.window;
				if (window !== void 0) return window;
			}
			if (key === void 0) return void 0;
			return fixes.contextWindows[key];
		}
		function resolveEffectiveAutoCompact(fixes, sessionId) {
			if (sessionId !== void 0) {
				const value = fixes.sessionOverrides[sessionId]?.autoCompactEnabled;
				if (value !== void 0) return value;
			}
			return fixes.autoCompactEnabled;
		}
		function patchSessionOverride(overrides, sessionId, patch) {
			const next = { ...overrides[sessionId] ?? {} };
			if (patch.window === null) delete next.window;
			else if (patch.window !== void 0) next.window = patch.window;
			if (patch.autoCompactEnabled === null) delete next.autoCompactEnabled;
			else if (patch.autoCompactEnabled !== void 0) next.autoCompactEnabled = patch.autoCompactEnabled;
			const rest = { ...overrides };
			if (next.window === void 0 && next.autoCompactEnabled === void 0) {
				delete rest[sessionId];
				return rest;
			}
			rest[sessionId] = next;
			return rest;
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
		const DEFAULT_FIXES = parseFixesSettings(void 0);
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function modelKey(provider, model) {
			return `${provider}/${model}`;
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
		function compactErrorText(reason) {
			if (!(reason instanceof Error)) return String(reason);
			const generic = /could not produce|useful summary/i.test(reason.message);
			const cause = reason.cause instanceof Error ? reason.cause.message : typeof reason.cause === "string" ? reason.cause : void 0;
			if (generic && cause) return cause;
			return reason.message;
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
			return readModelPair(rec.next) ?? readModelPair(rec.lastUsed) ?? readModelPair(rec.current) ?? readModelPair(rec.config) ?? readModelPair(rec);
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
			whiteSpace: "nowrap",
			flexShrink: 0
		};
		const popoverStyle = {
			position: "fixed",
			zIndex: 1e4,
			minWidth: 280,
			padding: 12,
			display: "flex",
			flexDirection: "column",
			gap: 12,
			borderRadius: 12,
			border: "0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,0.28))",
			background: "var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-1, #1c1c1c))",
			color: "var(--dsw-alias-label-primary, inherit)",
			boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
			pointerEvents: "auto"
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
			border: "0.5px solid transparent",
			font: "inherit",
			fontSize: 12
		};
		const errorStyle = {
			fontSize: 11,
			color: "var(--dsw-alias-state-error-primary, #f87171)",
			margin: 0
		};
		const noteStyle = {
			fontSize: 11,
			opacity: .72,
			margin: 0,
			lineHeight: "16px"
		};
		function checkboxRow(label, checked, disabled, onChange) {
			return (0, react.createElement)("label", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				fontSize: 12,
				opacity: disabled ? .5 : 1,
				cursor: disabled ? "not-allowed" : "pointer"
			} }, (0, react.createElement)("input", {
				type: "checkbox",
				checked,
				disabled,
				onChange: (event) => onChange(event.currentTarget.checked)
			}), label);
		}
		function apply(ctx) {
			const binder = settingsBinder(ctx);
			const fixesScope = binder?.bind({
				namespace: FIXES_NS,
				decode: parseFixesSettings
			});
			const piAiScope = binder?.bind({ namespace: PI_AI_NS });
			const defaultModelScope = binder?.bind({ namespace: "agent-default-model" });
			function ContextPanel(props) {
				const selection = typeof props.useProjection === "function" ? props.useProjection("modelSelection", (value) => value) : void 0;
				const defaultModel = useScopeValue(defaultModelScope, void 0);
				const current = modelFromSelection(selection) ?? readModelPair(defaultModel);
				const sessionSnapshot = typeof props.useSession === "function" ? props.useSession((value) => value) : void 0;
				const running = isRecord(sessionSnapshot) && sessionSnapshot.running === true;
				const sessionId = sessionIdOf(props.sessionId) ?? sessionIdOf(sessionSnapshot);
				const draft = typeof props.useInput === "function" ? String(props.useInput((value) => isRecord(value) && typeof value.draft === "string" ? value.draft : "") ?? "") : "";
				const fixes = useScopeValue(fixesScope, DEFAULT_FIXES);
				const piAi = useScopeValue(piAiScope, void 0);
				const catalogGroups = groupCatalogByProvider(catalogFromPiAi(piAi), providerLabelsFromPiAi(piAi));
				const [open, setOpen] = (0, react.useState)(false);
				const [error, setError] = (0, react.useState)("");
				const [compacting, setCompacting] = (0, react.useState)(false);
				const [pressed, setPressed] = (0, react.useState)(false);
				const [previewOpen, setPreviewOpen] = (0, react.useState)(false);
				const [draftPercent, setDraftPercent] = (0, react.useState)(null);
				const [popoverPos, setPopoverPos] = (0, react.useState)({
					bottom: 72,
					left: 16
				});
				const rootRef = (0, react.useRef)(null);
				const popoverRef = (0, react.useRef)(null);
				const savedDraftRef = (0, react.useRef)(null);
				const sawRunningRef = (0, react.useRef)(false);
				const setDraftRef = (0, react.useRef)(props.inputActions?.setDraft);
				(0, react.useEffect)(() => {
					if (!open) return;
					const chip = rootRef.current;
					if (chip !== null) {
						const rect = chip.getBoundingClientRect();
						setPopoverPos({
							bottom: Math.max(8, window.innerHeight - rect.top + 8),
							left: Math.max(8, rect.left)
						});
					}
					const onPointer = (event) => {
						const path = typeof event.composedPath === "function" ? event.composedPath() : [];
						const root = rootRef.current;
						const popover = popoverRef.current;
						if (root !== null && path.includes(root)) return;
						if (popover !== null && path.includes(popover)) return;
						if (event.target instanceof Node) {
							if (root !== null && root.contains(event.target)) return;
							if (popover !== null && popover.contains(event.target)) return;
						}
						setOpen(false);
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
				const selectedWindow = selectedWindowTokens(resolveEffectiveWindow(fixes, sessionId, current === void 0 ? void 0 : modelKey(current.provider, current.model)), current === void 0 ? void 0 : catalogContextWindow(piAi, current.provider, current.model));
				const surchargeNote = windowSurchargeNote(selectedWindow);
				const sessionWindowOn = sessionId !== void 0 && fixes.sessionOverrides[sessionId]?.window !== void 0;
				const sessionAutoOn = sessionId !== void 0 && fixes.sessionOverrides[sessionId]?.autoCompactEnabled !== void 0;
				const autoEnabled = resolveEffectiveAutoCompact(fixes, sessionId);
				const previewNodes = compactPreviewNodesFromSession(sessionSnapshot);
				const preview = previewCompactDrop(previewNodes);
				const previewLine = previewNodes.length === 0 ? "暂不可预览" : preview.line;
				const percent = draftPercent ?? Math.round(fixes.thresholdRatio * 100);
				const windowDisabled = false;
				const compactBusy = running || compacting;
				const compactTitle = compacting ? "压缩进行中" : running ? "忙碌" : "压缩当前会话";
				const chipCopy = contextChipCopy(selectedWindow);
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
				const persistOverrides = (next) => {
					persistField("sessionOverrides", next);
				};
				const onWindow = (tokens) => {
					if (sessionWindowOn && sessionId !== void 0) {
						persistOverrides(patchSessionOverride(fixes.sessionOverrides, sessionId, { window: tokens }));
						return;
					}
					if (current === void 0) {
						setError("无法解析当前模型，窗口改不了");
						return;
					}
					persistField("contextWindows", {
						...fixes.contextWindows,
						[modelKey(current.provider, current.model)]: tokens
					});
				};
				const onSessionWindowOnly = (only) => {
					if (sessionId === void 0) return;
					if (only) {
						persistOverrides(patchSessionOverride(fixes.sessionOverrides, sessionId, { window: selectedWindow ?? 1e5 }));
						return;
					}
					persistOverrides(patchSessionOverride(fixes.sessionOverrides, sessionId, { window: null }));
				};
				const onAutoEnabled = (enabled) => {
					if (sessionAutoOn && sessionId !== void 0) {
						persistOverrides(patchSessionOverride(fixes.sessionOverrides, sessionId, { autoCompactEnabled: enabled }));
						return;
					}
					persistField("autoCompactEnabled", enabled);
				};
				const onSessionAutoOnly = (only) => {
					if (sessionId === void 0) return;
					if (only) {
						persistOverrides(patchSessionOverride(fixes.sessionOverrides, sessionId, { autoCompactEnabled: resolveEffectiveAutoCompact(fixes, void 0) }));
						return;
					}
					persistOverrides(patchSessionOverride(fixes.sessionOverrides, sessionId, { autoCompactEnabled: null }));
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
					setError("正在压缩…");
					if (compacting) return;
					const actions = props.inputActions;
					const setDraft = actions?.setDraft;
					const submit = actions?.submit;
					if (typeof setDraft !== "function" || typeof submit !== "function") {
						setError("当前输入框没有 submit，请在输入框手动输入 /compact 回车");
						return;
					}
					const saved = draft;
					savedDraftRef.current = saved;
					setCompacting(true);
					try {
						setDraft("/compact");
					} catch (reason) {
						savedDraftRef.current = null;
						setError(compactErrorText(reason));
						setCompacting(false);
						return;
					}
					globalThis.requestAnimationFrame(() => {
						globalThis.requestAnimationFrame(() => {
							try {
								submit();
								setError("已提交 /compact");
							} catch (reason) {
								setError(compactErrorText(reason));
								setCompacting(false);
								try {
									setDraft(saved);
								} catch {}
							}
						});
					});
				};
				const summarizerValue = fixes.summarization === null ? "" : modelKey(fixes.summarization.provider, fixes.summarization.model);
				return (0, react.createElement)("div", {
					ref: rootRef,
					style: {
						position: "relative",
						display: "inline-flex",
						flexShrink: 0
					}
				}, (0, react.createElement)("button", {
					type: "button",
					style: chipStyle,
					title: chipCopy.title,
					"aria-label": chipCopy.title,
					"aria-expanded": open,
					"aria-haspopup": "dialog",
					onClick: () => setOpen((value) => !value)
				}, chipCopy.label), open ? (0, react.createElement)("div", {
					ref: popoverRef,
					role: "dialog",
					style: {
						...popoverStyle,
						bottom: popoverPos.bottom,
						left: popoverPos.left
					},
					onPointerDown: (event) => {
						event.stopPropagation();
					}
				}, (0, react.createElement)("div", { style: rowStyle }, (0, react.createElement)("div", { style: labelStyle }, "上下文"), (0, react.createElement)("div", { style: choiceRowStyle }, ...WINDOW_CHOICES.map((choice) => (0, react.createElement)("button", {
					key: choice.label,
					type: "button",
					disabled: windowDisabled,
					title: choice.label,
					style: choiceStyle(selectedWindow === choice.tokens, windowDisabled),
					onClick: () => onWindow(choice.tokens)
				}, choice.label))), surchargeNote ? (0, react.createElement)("p", { style: {
					fontSize: 11,
					color: "var(--dsw-alias-state-warning-primary, #f59e0b)",
					margin: 0,
					lineHeight: "16px"
				} }, surchargeNote) : null, checkboxRow("仅当前会话", sessionWindowOn, sessionId === void 0, onSessionWindowOnly)), (0, react.createElement)("div", { style: rowStyle }, (0, react.createElement)("label", { style: labelStyle }, "压缩模型"), (0, react.createElement)("select", {
					style: selectStyle,
					value: summarizerValue,
					onChange: (event) => onSummarizer(event.target.value)
				}, (0, react.createElement)("option", { value: "" }, "当前对话模型"), ...catalogGroups.map((group) => (0, react.createElement)("optgroup", {
					key: group.provider,
					label: group.label
				}, ...group.models.map((entry) => (0, react.createElement)("option", {
					key: modelKey(entry.provider, entry.model),
					value: modelKey(entry.provider, entry.model)
				}, entry.label)))))), (0, react.createElement)("div", { style: rowStyle }, (0, react.createElement)("label", { style: labelStyle }, "自动压缩"), checkboxRow("启用自动压缩", autoEnabled, false, onAutoEnabled), checkboxRow("仅当前会话", sessionAutoOn, sessionId === void 0, onSessionAutoOnly), (0, react.createElement)("input", {
					type: "range",
					min: 20,
					max: 90,
					step: 5,
					value: percent,
					disabled: !autoEnabled,
					onChange: (event) => {
						setDraftPercent(Number(event.currentTarget.value));
					},
					onPointerUp: (event) => {
						commitThreshold(event.currentTarget.value);
					},
					onKeyUp: (event) => {
						commitThreshold(event.currentTarget.value);
					}
				}), (0, react.createElement)("div", { style: {
					fontSize: 12,
					opacity: autoEnabled ? 1 : .5
				} }, autoEnabled ? `用到 ${percent}% 时压缩` : "已关闭自动压缩")), (0, react.createElement)("div", { style: rowStyle }, (0, react.createElement)("button", {
					type: "button",
					disabled: preview.count === 0,
					title: previewLine,
					style: {
						...noteStyle,
						background: "transparent",
						border: 0,
						padding: 0,
						color: "inherit",
						font: "inherit",
						textAlign: "left",
						cursor: preview.count === 0 ? "default" : "pointer"
					},
					onClick: () => {
						if (preview.count === 0) return;
						setPreviewOpen((value) => !value);
					}
				}, previewLine), previewOpen && preview.count > 0 ? (0, react.createElement)("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: 4,
					maxHeight: 160,
					overflow: "auto"
				} }, ...preview.dropped.map((item) => (0, react.createElement)("div", {
					key: String(item.seq),
					style: {
						fontSize: 11,
						lineHeight: "16px"
					}
				}, (0, react.createElement)("strong", null, item.title), item.excerpt ? ` · ${item.excerpt}` : ""))) : null), (0, react.createElement)("button", {
					type: "button",
					style: {
						...compactStyle,
						...compactButtonStyle({
							pressed,
							busy: compactBusy
						})
					},
					title: compactTitle,
					onPointerDown: () => setPressed(true),
					onPointerUp: () => setPressed(false),
					onPointerLeave: () => setPressed(false),
					onPointerCancel: () => setPressed(false),
					onClick: () => {
						onCompact();
					}
				}, compacting ? "压缩中…" : "压缩上下文"), (0, react.createElement)("p", { style: noteStyle }, "已爆仓的旧会话要先压缩；只改窗口不会缩短已经超长的历史。"), error ? (0, react.createElement)("p", { style: errorStyle }, error) : null) : null);
			}
			ctx.slots.inject("conversation.input.right", function() {
				return ctx.slots.register({
					name: "conversation.input.right",
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