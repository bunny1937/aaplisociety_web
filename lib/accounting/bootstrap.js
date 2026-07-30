import { registerPostingResolver, registerJournalPoster } from "@/lib/accounting/AccountingEngine.js";
import { resolvePosting } from "@/lib/accounting/postingRules/PostingRuleResolver.js";
import { postJournal } from "@/lib/accounting/journal/JournalPoster.js";

// Wires the pluggable pieces into the Accounting Engine's seams. ANY code
// path that calls AccountingEngine.process() must import this module first
// (import "@/lib/accounting/bootstrap"). Registration is idempotent and
// guarded on globalThis so repeated imports / dev hot-reloads register once.
//
// As of Phase 2.8 both seams are wired: the posting resolver (Phase 2.7) and
// the journal poster (Phase 2.8). The engine is now runnable end-to-end.

const flags = (globalThis.__accountingBootstrap ||= { resolver: false, poster: false });

if (!flags.resolver) {
  registerPostingResolver(resolvePosting);
  flags.resolver = true;
}

if (!flags.poster) {
  registerJournalPoster(postJournal);
  flags.poster = true;
}

export const bootstrapped = flags;
