/** A row in `conflict` or `refused` is waiting on a person, not on the network. */
export function needsReview(state) {
    return state === "conflict" || state === "refused";
}
/** Terminal means the drain worker is finished with it — not that it succeeded. */
export function isTerminal(state) {
    return state === "applied" || needsReview(state);
}
