/**
 * fomo's token-list vocabulary, lifted from its own bundle so ours cannot drift from theirs.
 */

/**
 * The chain set fomo runs with, as one comma-joined string. Observed live as the socket
 * topicId, and sent by fomo's own fetch wrapper as the X-Supported-Chains header on every
 * REST call (Ethereum appears only behind a feature gate).
 */
export const SUPPORTED_CHAINS = '1,56,143,4663,8453,1399811149'

/** fomo's list keys, exactly as they appear in its side panel config. */
export const LIST_KEYS = ['pre-graduated', 'graduated', 'trending'] as const
export type ListKey = (typeof LIST_KEYS)[number]

/** fomo's WebSocket topic names, and the list each one carries. */
export const TOPIC_TO_LIST: Readonly<Record<string, ListKey>> = {
  pre_graduated_tokens: 'pre-graduated',
  graduated_tokens: 'graduated',
  trending_tokens: 'trending',
}

/** Column headings. fomo labels `pre-graduated` as "Bonding". */
export const LIST_LABEL: Readonly<Record<ListKey, string>> = {
  'pre-graduated': 'Bonding',
  graduated: 'Graduated',
  trending: 'Trending',
}

/**
 * fomo's list diff protocol, verified against live frames:
 *   snapshot -> replace with `tokens`
 *   new      -> insert `update` at `index`
 *   update   -> remove `tokenKey`, then insert `update` at `index`
 *   remove   -> remove `tokenKey`
 */
export type ListDiff =
  | { kind: 'snapshot'; tokens: unknown[] }
  | { kind: 'new'; index: number; update: unknown }
  | { kind: 'update'; index: number; tokenKey: string; update: unknown }
  | { kind: 'remove'; tokenKey: string }
