import * as CollapsiblePrimitive from "@rn-primitives/collapsible";

/**
 * Mirrors the web collapsible, unstyled — exactly as the web wrapper is.
 *
 * Worth knowing before using it: the ops list screens deliberately do NOT use
 * this. `Sections` keeps its collapsed state keyed by section title so folding
 * "Done" away survives a refresh that reorders the sections, which a
 * self-contained Collapsible cannot do because its state dies with the node.
 * Use this for disclosure inside a screen; use `Sections` for lists that resync.
 */
const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
const CollapsibleContent = CollapsiblePrimitive.Content;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
