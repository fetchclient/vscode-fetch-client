import "./style.css";
import React, {
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useSelector } from "react-redux";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	BLUR_COMMAND,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	EditorConfig,
	FOCUS_COMMAND,
	INSERT_LINE_BREAK_COMMAND,
	KEY_ENTER_COMMAND,
	LexicalNode,
	NodeKey,
	PASTE_COMMAND,
	SerializedTextNode,
	Spread,
	TextNode,
} from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { IRootState } from "../../../reducer/combineReducer";
import { checkSysVariable } from "../../../../fetch-client-core/helpers/systemVariable.helper";
import { replaceDataWithVariable } from "../../../../fetch-client-core/helpers/variable.helper";

export interface TextEditorProps {
	varWords: string[];
	focus: boolean;
	className?: string;
	value?: string;
	placeholder?: string;
	maxLength?: number;
	disabled?: boolean;
	onChange?: (value: string) => void;
	onKeyPress?: (keyCode: number) => void;
	onBlur?: () => void;
	onFocus?: () => void;
}

// ─── Regex ──────────────────────────────────────────────────────────────────
const VAR_REGEX = /{{[A-Za-z0-9\s!@#$%^&*()_+\-=`~\\\]\[|';:\/.,?><]+}}/g;
const FULL_VAR_REGEX = new RegExp(`^${VAR_REGEX.source}$`);

// Tag used to mark programmatic editor updates so onChange is not called
const EXTERNAL_TAG = "fc-external";

// ─── Context for variable data (tooltip support) ────────────────────────────
const VarDataContext = React.createContext<Record<string, string>>({});

// ─── VariableNode ─────────────────────────────────────────────────────────
type VariableStatus = "valid" | "invalid";

type SerializedVariableNode = Spread<
	{ status: VariableStatus },
	SerializedTextNode
>;

function applyVariableDom(dom: HTMLElement, status: VariableStatus): void {
	dom.style.color = status === "invalid" ? "#f05348" : "rgb(18, 187, 18)";
	dom.dataset.variable = "true";
}

// A text node (not a decorator) so the caret can enter and edit the variable.
export class VariableNode extends TextNode {
	__status: VariableStatus;

	static override getType(): string {
		return "variable";
	}

	static override clone(node: VariableNode): VariableNode {
		return new VariableNode(node.__text, node.__status, node.__key);
	}

	static override importJSON(serialized: SerializedVariableNode): VariableNode {
		return new VariableNode(serialized.text, serialized.status);
	}

	constructor(text: string, status: VariableStatus, key?: NodeKey) {
		super(text, key);
		this.__status = status;
	}

	override exportJSON(): SerializedVariableNode {
		return {
			...super.exportJSON(),
			type: "variable",
			version: 1,
			status: this.__status,
		};
	}

	override createDOM(config: EditorConfig): HTMLElement {
		const dom = super.createDOM(config);
		applyVariableDom(dom, this.__status);
		return dom;
	}

	override updateDOM(
		prevNode: this,
		dom: HTMLElement,
		config: EditorConfig,
	): boolean {
		const needsReplace = super.updateDOM(prevNode, dom, config);
		if (prevNode.__status !== this.__status) {
			applyVariableDom(dom, this.__status);
		}
		return needsReplace;
	}

	// Typing at the edges must start a new text node, not extend the variable.
	override canInsertTextBefore(): boolean {
		return false;
	}

	override canInsertTextAfter(): boolean {
		return false;
	}
}

function $createVariableNode(
	text: string,
	status: VariableStatus,
): VariableNode {
	return new VariableNode(text, status);
}

function $isVariableNode(
	node: LexicalNode | null | undefined,
): node is VariableNode {
	return node instanceof VariableNode;
}

// ─── Helper ──────────────────────────────────────────────────────────────────
function getVariableStatus(token: string, varWords: string[]): VariableStatus {
	if (checkSysVariable(token)) {
		return "valid";
	}
	const varName = token.slice(2, -2).trim();
	return varWords.includes(varName) ? "valid" : "invalid";
}

// ─── VariablePlugin ────────────────────────────────────────────────────────
// Transforms TextNodes containing {{...}} into VariableNodes.
// Re-evaluates existing VariableNodes when varWords change.
function VariablePlugin({ varWords }: { varWords: string[] }) {
	const [editor] = useLexicalComposerContext();
	const varWordsRef = useRef(varWords);
	const varData = useContext(VarDataContext);
	const varDataRef = useRef(varData);

	// Keep refs current so closures always read the latest values
	useEffect(() => {
		varWordsRef.current = varWords;
		varDataRef.current = varData;
	});

	// Re-color existing VariableNodes when varWords change
	useEffect(() => {
		editor.update(
			() => {
				const root = $getRoot();
				for (const child of root.getChildren()) {
					if ($isParagraphNode(child)) {
						for (const node of child.getChildren()) {
							if ($isVariableNode(node)) {
								const newStatus = getVariableStatus(
									node.getTextContent(),
									varWords,
								);
								if (newStatus !== node.__status) {
									node.getWritable().__status = newStatus;
								}
							}
						}
					}
				}
			},
			{ tag: EXTERNAL_TAG },
		);
	}, [editor, varWords]);

	// Tooltip with the resolved value, computed on hover so it is never stale
	useEffect(() => {
		const onOver = (e: MouseEvent) => {
			const el = e.target as HTMLElement | null;
			if (!el?.dataset?.variable) {
				return;
			}
			const text = el.textContent ?? "";
			const resolved = checkSysVariable(text)
				? text
				: replaceDataWithVariable(text, varDataRef.current);
			el.title = resolved !== text ? resolved : "";
		};
		return editor.registerRootListener((root, prevRoot) => {
			prevRoot?.removeEventListener("mouseover", onOver);
			root?.addEventListener("mouseover", onOver);
		});
	}, [editor]);

	// Wrap {{...}} in a VariableNode; unwrap a VariableNode once it stops matching.
	useEffect(() => {
		const transform = (node: TextNode) => {
			const text = node.getTextContent();

			if ($isVariableNode(node)) {
				if (FULL_VAR_REGEX.test(text)) {
					const status = getVariableStatus(text, varWordsRef.current);
					if (status !== node.__status) {
						node.getWritable().__status = status;
					}
					return;
				}
				const selection = $getSelection();
				const offset =
					$isRangeSelection(selection) &&
					selection.isCollapsed() &&
					selection.anchor.key === node.getKey()
						? selection.anchor.offset
						: null;
				const plain = $createTextNode(text);
				node.replace(plain);
				if (offset !== null) {
					plain.select(offset, offset);
				}
				return;
			}

			VAR_REGEX.lastIndex = 0;
			const match = VAR_REGEX.exec(text);
			if (!match) {
				return;
			}

			const start = match.index;
			const end = start + match[0].length;
			const offsets = [start, end].filter((o) => o > 0 && o < text.length);
			const parts = offsets.length > 0 ? node.splitText(...offsets) : [node];
			const target = parts[start > 0 ? 1 : 0];

			target.replace(
				$createVariableNode(
					match[0],
					getVariableStatus(match[0], varWordsRef.current),
				),
			);
		};

		const unregText = editor.registerNodeTransform(TextNode, transform);
		const unregVar = editor.registerNodeTransform(VariableNode, transform);
		return () => {
			unregText();
			unregVar();
		};
	}, [editor]);

	return null;
}

// ─── SingleLinePlugin ──────────────────────────────────────────────────────
// Prevents Enter/newlines; strips newlines on paste; respects maxLength.
function SingleLinePlugin({
	onKeyPress,
	maxLength,
	textLengthRef,
}: {
	onKeyPress?: (keyCode: number) => void;
	maxLength?: number;
	textLengthRef: React.MutableRefObject<number>;
}) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		const unregEnter = editor.registerCommand(
			KEY_ENTER_COMMAND,
			(e: KeyboardEvent | null) => {
				if (e) {
					e.preventDefault();
				}
				onKeyPress?.(13);
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		const unregLineBreak = editor.registerCommand(
			INSERT_LINE_BREAK_COMMAND,
			() => true,
			COMMAND_PRIORITY_HIGH,
		);

		const unregPaste = editor.registerCommand(
			PASTE_COMMAND,
			(e: ClipboardEvent | InputEvent | null) => {
				if (!e) {
					return false;
				}
				e.preventDefault();

				let text = "";
				if (e instanceof ClipboardEvent) {
					text = e.clipboardData?.getData("text/plain") ?? "";
				} else if (e instanceof InputEvent) {
					text = e.data ?? "";
				}

				text = text.replace(/[\n\r]/g, " ");

				if (maxLength) {
					const remaining = maxLength - textLengthRef.current;
					if (remaining <= 0) {
						return true;
					}
					text = text.slice(0, remaining);
				}

				const selection = $getSelection();
				if ($isRangeSelection(selection)) {
					selection.insertText(text);
				}
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		return () => {
			unregEnter();
			unregLineBreak();
			unregPaste();
		};
	}, [editor, onKeyPress, maxLength, textLengthRef]);

	return null;
}

// ─── SetValuePlugin ────────────────────────────────────────────────────────
// Pushes external value changes into the editor without triggering onChange.
// Compares against the live editor text so that a parent echoing back the
// user's own keystroke (props.onChange → setState → props.value) does NOT
// reset the editor (which would move the cursor to position 0).
function SetValuePlugin({ value }: { value: string }) {
	const [editor] = useLexicalComposerContext();
	const isFirstRender = useRef(true);

	useEffect(() => {
		// Skip first render - initial value was set via initialConfig
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return;
		}

		// Read what the editor currently contains
		const currentText = editor
			.getEditorState()
			.read(() => $getRoot().getTextContent());

		// If the incoming value already matches the editor, the parent is just
		// echoing back a user-typed change - no reset needed.
		if (value === currentText) {
			return;
		}

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const paragraph = $createParagraphNode();
				paragraph.append($createTextNode(value));
				root.append(paragraph);
				// Place cursor at the end after external replacement
				const rootElement = editor.getRootElement();
				if (rootElement && rootElement === document.activeElement) {
					paragraph.selectEnd();
				}
			},
			{ tag: EXTERNAL_TAG },
		);
	}, [editor, value]);

	return null;
}

// ─── FocusPlugin ───────────────────────────────────────────────────────────
function FocusPlugin({ focus }: { focus: boolean }) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		if (focus) {
			editor.focus();
		}
	}, [editor, focus]);

	return null;
}

// ─── BlurFocusPlugin ───────────────────────────────────────────────────────
function BlurFocusPlugin({
	onBlur,
	onFocus,
}: {
	onBlur?: () => void;
	onFocus?: () => void;
}) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		const unregBlur = editor.registerCommand(
			BLUR_COMMAND,
			() => {
				onBlur?.();
				return false;
			},
			COMMAND_PRIORITY_LOW,
		);

		const unregFocus = editor.registerCommand(
			FOCUS_COMMAND,
			() => {
				onFocus?.();
				return false;
			},
			COMMAND_PRIORITY_LOW,
		);

		return () => {
			unregBlur();
			unregFocus();
		};
	}, [editor, onBlur, onFocus]);

	return null;
}

// ─── EditablePlugin ────────────────────────────────────────────────────────
function EditablePlugin({ disabled }: { disabled?: boolean }) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		editor.setEditable(!disabled);
	}, [editor, disabled]);

	return null;
}

// ─── TextEditor ────────────────────────────────────────────────────────────
export const TextEditor = (props: TextEditorProps) => {
	const { selectedVariable } = useSelector(
		(state: IRootState) => state.variableData,
	);

	const [varData, setVarData] = useState<Record<string, string>>({});
	const textLengthRef = useRef(0);

	useEffect(() => {
		if (selectedVariable.data.length > 0) {
			const data: Record<string, string> = {};
			selectedVariable.data.forEach((item) => {
				data[item.key] = item.value;
			});
			setVarData(data);
		}
	}, [selectedVariable]);

	// Capture initial value once so initialConfig dep array stays empty
	const initialValueRef = useRef(props.value ?? "");

	// LexicalComposer only reads initialConfig on mount
	const initialConfig = useRef({
		namespace: "TextEditor",
		nodes: [VariableNode],
		onError: (error: Error) => console.error(error),
		editorState: () => {
			const paragraph = $createParagraphNode();
			paragraph.append($createTextNode(initialValueRef.current));
			$getRoot().append(paragraph);
		},
	}).current;

	const handleChange = useCallback(
		(editorState: any, _editor: any, tags: Set<string>) => {
			if (tags.has(EXTERNAL_TAG)) {
				return;
			}

			editorState.read(() => {
				const text = $getRoot().getTextContent();
				textLengthRef.current = text.length;
				props.onChange?.(text);
			});
		},
		[props.onChange],
	);

	return (
		<VarDataContext.Provider value={varData}>
			<div className="outer-container">
				<LexicalComposer initialConfig={initialConfig}>
					<div className="DraftEditor-root">
						<PlainTextPlugin
							contentEditable={
								<ContentEditable
									className={`DraftEditor-editorContainer${
										props.className ? " " + props.className : ""
									}`}
								/>
							}
							placeholder={
								props.placeholder ? (
									<div className="public-DraftEditorPlaceholder-inner">
										{props.placeholder}
									</div>
								) : null
							}
							ErrorBoundary={LexicalErrorBoundary}
						/>
					</div>
					<HistoryPlugin />
					<OnChangePlugin ignoreSelectionChange onChange={handleChange} />
					<VariablePlugin varWords={props.varWords} />
					<SingleLinePlugin
						onKeyPress={props.onKeyPress}
						maxLength={props.maxLength}
						textLengthRef={textLengthRef}
					/>
					<SetValuePlugin value={props.value ?? ""} />
					<FocusPlugin focus={props.focus} />
					<BlurFocusPlugin onBlur={props.onBlur} onFocus={props.onFocus} />
					<EditablePlugin disabled={props.disabled} />
				</LexicalComposer>
			</div>
		</VarDataContext.Provider>
	);
};
