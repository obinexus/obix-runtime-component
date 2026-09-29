/**
 * The canonical DOP IR as the native runtime READS it (Phase 6, docs/recovery/native-runtime.md): the types and closed vocabularies of obix-dop-ir/3, stated here because a
 * runtime package depends on no compiler package (graph rules R5, R11) — and held, word for word and type for type, to the IR's own definition in
 * obix-compiler-ir by tests/runtime/ir-contract.test.mjs. A change of the IR that the runtime does not follow fails there.
 */

/** The schema this runtime reads. */
export const OBIX_RUNTIME_IR_SCHEMA = "obix-dop-ir/3" as const;

const NODE_KINDS = Object.freeze(["element", "text", "conditional", "iteration", "invocation", "projection"] as const);
const EXPRESSION_KINDS = Object.freeze(["literal", "array", "object", "reference", "event-payload", "member", "index", "unary", "binary", "logical", "choice", "call"] as const);
const STEP_KINDS = Object.freeze(["assign", "invoke", "output"] as const);
const REFERENCE_SCOPES = Object.freeze(["prop", "state", "derived", "local"] as const);
const FUNCTIONS = Object.freeze(["round"] as const);
const FUNCTION_ARITY: Readonly<Record<ObixIrFunction, number>> = Object.freeze({ round: 1 });
const UNARY_OPERATORS = Object.freeze(["!", "-", "+"] as const);
const BINARY_OPERATORS = Object.freeze(["+", "-", "*", "/", "%", "===", "!==", "<", "<=", ">", ">="] as const);
const LOGICAL_OPERATORS = Object.freeze(["&&", "||", "??"] as const);
const PROP_TYPES = Object.freeze(["string", "number", "boolean", "array", "object", "function", "unknown"] as const);
const STYLE_SCOPES = Object.freeze(["component", "global"] as const);

export type ObixIrNodeKind = (typeof NODE_KINDS)[number];
export type ObixIrExpressionKind = (typeof EXPRESSION_KINDS)[number];
export type ObixIrStepKind = (typeof STEP_KINDS)[number];
export type ObixIrReferenceScope = (typeof REFERENCE_SCOPES)[number];
export type ObixIrFunction = (typeof FUNCTIONS)[number];
export type ObixIrUnaryOperator = (typeof UNARY_OPERATORS)[number];
export type ObixIrBinaryOperator = (typeof BINARY_OPERATORS)[number];
export type ObixIrLogicalOperator = (typeof LOGICAL_OPERATORS)[number];
export type ObixIrPropType = (typeof PROP_TYPES)[number];
export type ObixIrStyleScope = (typeof STYLE_SCOPES)[number];

/** Every closed vocabulary of the IR this runtime reads. */
export const OBIX_RUNTIME_IR = Object.freeze({
  schema: OBIX_RUNTIME_IR_SCHEMA,
  nodeKinds: NODE_KINDS,
  expressionKinds: EXPRESSION_KINDS,
  stepKinds: STEP_KINDS,
  referenceScopes: REFERENCE_SCOPES,
  functions: FUNCTIONS,
  functionArity: FUNCTION_ARITY,
  unaryOperators: UNARY_OPERATORS,
  binaryOperators: BINARY_OPERATORS,
  logicalOperators: LOGICAL_OPERATORS,
  propTypes: PROP_TYPES,
  styleScopes: STYLE_SCOPES,
});

// ── expressions ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A JSON scalar. A number is finite and is not `-0`, so that what is written is what is read back: the text of `-0` is `0`.
 *
 * `-0` is a value nevertheless, and the IR keeps it apart from `0` (`Object.is` is what an equality of values means here): it is written as the negation of the literal 0, an
 * `ObixIrUnary` — which is also a constant wherever a constant is needed (D-77).
 */
export interface ObixIrLiteral {
  readonly kind: "literal";
  readonly value: null | boolean | number | string;
}

export interface ObixIrArray {
  readonly kind: "array";
  readonly elements: readonly ObixIrExpression[];
}

export interface ObixIrObjectEntry {
  readonly key: string;
  readonly value: ObixIrExpression;
}

export interface ObixIrObject {
  readonly kind: "object";
  readonly entries: readonly ObixIrObjectEntry[];
}

/** The value of a prop, a state, a derived value, or a local that is in scope where the reference is written. It is resolved by the frontend, never by the reader. */
export interface ObixIrReference {
  readonly kind: "reference";
  readonly scope: ObixIrReferenceScope;
  readonly name: string;
}

/** The value the host gives an event handler about the event that happened — exists only inside an event handler. */
export interface ObixIrEventPayload {
  readonly kind: "event-payload";
}

export interface ObixIrMember {
  readonly kind: "member";
  readonly object: ObixIrExpression;
  readonly property: string;
}

export interface ObixIrIndex {
  readonly kind: "index";
  readonly object: ObixIrExpression;
  readonly index: ObixIrExpression;
}

export interface ObixIrUnary {
  readonly kind: "unary";
  readonly operator: ObixIrUnaryOperator;
  readonly operand: ObixIrExpression;
}

export interface ObixIrBinary {
  readonly kind: "binary";
  readonly operator: ObixIrBinaryOperator;
  readonly left: ObixIrExpression;
  readonly right: ObixIrExpression;
}

export interface ObixIrLogical {
  readonly kind: "logical";
  readonly operator: ObixIrLogicalOperator;
  readonly left: ObixIrExpression;
  readonly right: ObixIrExpression;
}

/** `test ? consequent : alternate`. */
export interface ObixIrChoice {
  readonly kind: "choice";
  readonly test: ObixIrExpression;
  readonly consequent: ObixIrExpression;
  readonly alternate: ObixIrExpression;
}

export type ObixIrExpression =
  | ObixIrLiteral
  | ObixIrArray
  | ObixIrObject
  | ObixIrReference
  | ObixIrEventPayload
  | ObixIrMember
  | ObixIrIndex
  | ObixIrUnary
  | ObixIrBinary
  | ObixIrLogical
  | ObixIrChoice
  | ObixIrCall;

/** The call of an intrinsic function (C3): one of OBIX_IR_FUNCTIONS, with the arguments it takes — never a call of user code. */
export interface ObixIrCall {
  readonly kind: "call";
  readonly function: ObixIrFunction;
  readonly arguments: readonly ObixIrExpression[];
}

// ── steps ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Write the value of `value` into the state named `target`. Steps run in order, and each sees what the ones before it wrote. */
export interface ObixIrAssign {
  readonly kind: "assign";
  readonly id: string;
  readonly target: string;
  readonly value: ObixIrExpression;
}

/** Run the steps of the action named `action`, its parameters bound, in order, to the values of `arguments` (a missing argument is `undefined`, an extra one is ignored). */
export interface ObixIrInvoke {
  readonly kind: "invoke";
  readonly id: string;
  readonly action: string;
  readonly arguments: readonly ObixIrExpression[];
}

/**
 * Tell the invoker of this component, on the output `channel`, the value of `value` (`null`: nothing — the invoker's handler then reads `undefined`), and run the invoker's steps
 * for that channel (its interaction) before the next step: synchronously, as a Vue emit and a React callback are. With no invoker, or none listening on the channel, nothing.
 */
export interface ObixIrOutputStep {
  readonly kind: "output";
  readonly id: string;
  readonly channel: string;
  readonly value: ObixIrExpression | null;
}

export type ObixIrStep = ObixIrAssign | ObixIrInvoke | ObixIrOutputStep;

// ── the declarations of a component ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ObixIrProp {
  readonly id: string;
  readonly name: string;
  /** What the prop is. A `boolean` prop means what an HTML boolean attribute means: not given is `false` (unless it has a default), given as the empty string — a bare attribute — is `true`. */
  readonly type: ObixIrPropType;
  readonly required: boolean;
  /** The value when the prop is not given: a constant (a literal, minus zero, or an array or object of constants), or `null` when there is none. */
  readonly default: ObixIrExpression | null;
}

/**
 * A channel on which the component tells its invoker that something happened (an `output` step), and the type of what it tells: a type of the IR, or `null` for nothing. What
 * Vue declares with `defineEmits` and React as a callback prop are both an output.
 */
export interface ObixIrOutput {
  readonly id: string;
  readonly channel: string;
  readonly payload: ObixIrPropType | null;
}

export interface ObixIrState {
  readonly id: string;
  readonly name: string;
  /** A constant: a literal, minus zero, or an array or object of constants. */
  readonly initial: ObixIrExpression;
}

export interface ObixIrDerived {
  readonly id: string;
  readonly name: string;
  readonly expression: ObixIrExpression;
}

export interface ObixIrAction {
  readonly id: string;
  readonly name: string;
  /** The locals of the steps, bound to the arguments of an invocation in order. */
  readonly parameters: readonly string[];
  readonly steps: readonly ObixIrStep[];
}

/**
 * After every change — an event handled, another effect run — evaluate `watch`; when its value is no longer the one seen last time (`Object.is`, the first sight being the value
 * at the start), run `steps` with `parameters` bound to the new value and the previous one. At most two parameters. It is not run at the start.
 */
export interface ObixIrEffect {
  readonly id: string;
  readonly watch: ObixIrExpression;
  readonly parameters: readonly string[];
  readonly steps: readonly ObixIrStep[];
}

/** A component this one invokes, addressed the way the source addresses it — by module specifier and export — and never resolved here. */
export interface ObixIrDependency {
  readonly id: string;
  /** The name the view invokes it by. */
  readonly local: string;
  readonly specifier: string;
  /** `default`, or the name of the export. */
  readonly export: string;
}

/** The rules of a stylesheet of the component, as written: the language is a name, the content is the text — nothing is compiled here. */
export interface ObixIrStyle {
  readonly id: string;
  readonly language: string;
  readonly scope: ObixIrStyleScope;
  readonly content: string;
}

// ── the view ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An attribute with a fixed value; a valueless attribute has the empty string. */
export interface ObixIrAttribute {
  readonly id: string;
  readonly name: string;
  readonly value: string;
}

/** An attribute or input whose value is an expression, evaluated every time the view is. */
export interface ObixIrPropertyBinding {
  readonly id: string;
  readonly name: string;
  readonly value: ObixIrExpression;
}

/** When `event` happens to the element, run `steps`; the event payload is in scope. */
export interface ObixIrEventBinding {
  readonly id: string;
  readonly event: string;
  readonly steps: readonly ObixIrStep[];
}

/**
 * The accessibility attributes of an element — `role`, `tabindex`, `alt`, `for`, every `aria-*` — kept apart from its other attributes, so that what makes the element
 * perceivable is where a checker looks for it (`isAccessibilityAttribute`). They are given as the source gave them, fixed or bound; nothing is inferred.
 */
export interface ObixIrAccessibility {
  readonly attributes: readonly ObixIrAttribute[];
  readonly properties: readonly ObixIrPropertyBinding[];
}

export interface ObixIrElement {
  readonly kind: "element";
  readonly id: string;
  readonly tag: string;
  readonly attributes: readonly ObixIrAttribute[];
  readonly properties: readonly ObixIrPropertyBinding[];
  readonly accessibility: ObixIrAccessibility;
  readonly events: readonly ObixIrEventBinding[];
  readonly children: readonly ObixIrNode[];
}

export interface ObixIrTextStatic {
  readonly kind: "static";
  readonly value: string;
}

/** The value of the expression as text: `null` and `undefined` as nothing, strings as they are, numbers and booleans as ECMAScript writes them, arrays and objects as JSON indented by two spaces. */
export interface ObixIrTextDisplay {
  readonly kind: "display";
  readonly expression: ObixIrExpression;
}

export type ObixIrTextPart = ObixIrTextStatic | ObixIrTextDisplay;

/** One text: the parts, in order, run together. */
export interface ObixIrText {
  readonly kind: "text";
  readonly id: string;
  readonly parts: readonly ObixIrTextPart[];
}

export interface ObixIrBranch {
  readonly id: string;
  readonly condition: ObixIrExpression;
  readonly body: readonly ObixIrNode[];
}

/** Show the body of the first branch whose condition is truthy; when there is none, `otherwise` (`null` when there is not one). */
export interface ObixIrConditional {
  readonly kind: "conditional";
  readonly id: string;
  readonly branches: readonly ObixIrBranch[];
  readonly otherwise: readonly ObixIrNode[] | null;
}

/** For each element of the array `source`, in order, show `body` with `item` bound to it and `index` (when there is one) to its position; `key` says which element is which. */
export interface ObixIrIteration {
  readonly kind: "iteration";
  readonly id: string;
  readonly source: ObixIrExpression;
  readonly item: string;
  readonly index: string | null;
  readonly key: ObixIrExpression | null;
  readonly body: readonly ObixIrNode[];
}

/**
 * How a projection's content receives what the projection hands it: `argument` null binds the whole of the arguments, as an object, to `local`; a name binds the argument of
 * that name.
 */
export interface ObixIrProjectionParameter {
  readonly local: string;
  readonly argument: string | null;
}

/** What an invocation puts into the projection named `slot` of the invoked component. The default content — what React calls `children` — is `default`. */
export interface ObixIrProjectionContent {
  readonly id: string;
  readonly slot: string;
  readonly parameters: readonly ObixIrProjectionParameter[];
  readonly body: readonly ObixIrNode[];
}

/** When the invoked component tells on the output `channel`, run `steps` — in the invoker, the value told as the event payload — as an element's event binding runs on an event. */
export interface ObixIrInteraction {
  readonly id: string;
  readonly channel: string;
  readonly steps: readonly ObixIrStep[];
}

/** Show the component named `component` (a dependency), given fixed and bound inputs, with `children` for its projections and `interactions` for its outputs. */
export interface ObixIrInvocation {
  readonly kind: "invocation";
  readonly id: string;
  readonly component: string;
  readonly attributes: readonly ObixIrAttribute[];
  readonly properties: readonly ObixIrPropertyBinding[];
  readonly children: readonly ObixIrProjectionContent[];
  readonly interactions: readonly ObixIrInteraction[];
}

export interface ObixIrProjectionArgument {
  readonly id: string;
  readonly name: string;
  readonly value: ObixIrExpression;
}

/**
 * The place where what an invoker put into `slot` is shown, given `arguments`; when the invoker put nothing there, or only what is EMPTY, `fallback`. What is empty is what has no
 * node that is there: a conditional that shows no branch, an iteration over no elements, a projection whose own content and fallback are empty — and a list of nodes of those alone.
 * An element, a component and a text are there, and a text of nothing is a text: it is there and shows nothing, and the fallback is not shown for it.
 */
export interface ObixIrProjection {
  readonly kind: "projection";
  readonly id: string;
  readonly slot: string;
  readonly arguments: readonly ObixIrProjectionArgument[];
  readonly fallback: readonly ObixIrNode[];
}

export type ObixIrNode = ObixIrElement | ObixIrText | ObixIrConditional | ObixIrIteration | ObixIrInvocation | ObixIrProjection;

// ── the component ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ObixIrComponent {
  readonly schema: "obix-dop-ir/3";
  readonly kind: "component";
  readonly id: string;
  readonly name: string;
  readonly props: readonly ObixIrProp[];
  readonly state: readonly ObixIrState[];
  readonly derived: readonly ObixIrDerived[];
  readonly outputs: readonly ObixIrOutput[];
  readonly actions: readonly ObixIrAction[];
  readonly effects: readonly ObixIrEffect[];
  readonly dependencies: readonly ObixIrDependency[];
  readonly view: readonly ObixIrNode[];
  readonly styles: readonly ObixIrStyle[];
}

/** One place where two plain-data values differ; `path` addresses it (`state[0].initial.value`, `view[0].children[2].tag`). */
export interface ObixIrDifference {
  readonly path: string;
  readonly a: unknown;
  readonly b: unknown;
}
