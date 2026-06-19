# Picking an embedded DB for chat history (tiny + fast)

Companion to [research-loop-rust-implementation.md](research-loop-rust-implementation.md). That doc noted Prototyper currently persists chat history as a per-entity `.chat.json` sidecar file (rewritten whole on every message — see `useChat`/`writeFile` usage across panels) and that Odysseus instead uses SQLite via SQLAlchemy with a `sessions` + `chat_messages` table pair, lazy-hydrated, one row written per message (`thoughts/research/research-agent-prototyper.md`'s parent conversation). This doc answers: if you want that DB-backed model in Rust, but optimized for "tiny and fast" rather than Odysseus's web-server-scale needs, what should you actually use?

## The workload, stated plainly

Per-message append (small payloads — text + maybe tool-call JSON), per-session ordered range-read (load all messages for one plan/chat, in order), occasional whole-session delete, no concurrent multi-process access (single desktop app, one process). This is about as friendly a workload as embedded storage gets: no complex joins, no high write concurrency, no multi-GB datasets. The right tool is whichever one has the least overhead for "append a small record, read a sequential range," not whichever has the most features.

## Options evaluated

### redb — recommended

Pure-Rust embedded key-value store, copy-on-write B+trees, "loosely inspired by lmdb." [github.com/cberner/redb](https://github.com/cberner/redb)

- **Maturity:** listed as "stable and maintained," stable on-disk file format, current version 4.1.0 (April 2026) — not a 1.0-labeled crate but treated as production-ready by its maintainer.
- **Guarantees:** fully ACID transactions, MVCC (concurrent readers don't block the single writer), crash-safe by default, with savepoint/rollback support.
- **Zero C dependencies** — pure Rust, so no bundled SQLite amalgamation, no `cc`/C toolchain requirement at build time, smallest realistic binary footprint of the options here.
- **Benchmarks from the repo's own suite** (its README; lower = faster, ms):

  | Operation | redb | lmdb | rocksdb | sled |
  |---|---|---|---|---|
  | Bulk load | 17,063 | 9,232 | 13,969 | 24,971 |
  | Individual writes | **920** | 1,598 | 2,432 | — |
  | Batch writes | 1,595 | 942 | 451 | — |
  | Random reads | 1,138 | 637 | 2,911 | — |

  The workload here is overwhelmingly "individual writes" (one message at a time) — the column redb wins outright, beating lmdb by ~40% and rocksdb by over 2x.
- **API shape:** transactional, `BTreeMap`-style — open a write transaction, open a named `Table<K, V>`, insert, commit. Keys are ordered, so a composite key like `(session_id, seq_num)` gives you free, no-extra-index range scans for "all messages in this session, in order" — exactly the one query this workload actually needs.
- **Fit:** this is a key-value store, not SQL — no joins, no `WHERE content LIKE`. Fine here: the only access patterns are "by session, ordered" and "by id," both of which a composite-key table handles natively.

### native_db — redb with a typed/ORM layer, if raw KV ergonomics feel too low-level

[github.com/vincent-herlemont/native_db](https://github.com/vincent-herlemont/native_db) — built directly on redb, adds `#[native_db]`/`#[native_model]` derive macros so you define a `ChatMessage` struct once and get primary/secondary indexes, typed queries, and real-time insert/update/delete subscriptions for free, while keeping redb's ACID guarantees underneath.

- **Maturity:** version 0.8.2, explicitly "active development," API "not stable yet and may change" — meaningfully less settled than redb itself.
- **Trade-off:** nicer ergonomics (no manual key-encoding scheme, secondary index on e.g. `entity_id` without designing the composite key by hand), at the cost of a pre-1.0 API and one more dependency layer between you and the storage engine. Reasonable pick if the derive-macro ergonomics matter more than minimizing dependency surface; redb directly is the more conservative choice for "tiny."

### rusqlite (SQLite) — the safe fallback, not the fast pick

[docs.rs/rusqlite](https://docs.rs/rusqlite/) — the standard, extremely mature Rust binding to SQLite.

- **Maturity:** by far the most battle-tested option here — SQLite itself has decades of production hardening; `rusqlite` is a thin, stable wrapper.
- **Cost:** the `bundled` feature compiles SQLite's C amalgamation into your binary — a real C dependency at build time (needs a C toolchain available, though this is rarely an issue on the platforms Tauri already targets) and a larger binary than a pure-Rust crate, though "larger" here is still only on the order of ~1MB, not actually disqualifying for "tiny."
- **What you gain:** real SQL — `ORDER BY timestamp`, `LIKE`/FTS5 full-text search across all chat history, ad-hoc joins if you ever want "show me every plan mentioning X across every session" — none of which redb gives you without hand-rolling it.
- **Verdict:** slower for the pure append/range-scan workload than redb on paper, but if you anticipate wanting full-text search across chat history (a genuinely useful feature — "find that conversation where I discussed X") sooner rather than later, SQLite's FTS5 extension gets you there with zero extra infrastructure, where redb would require building a separate inverted-index table by hand.

### sled — ruled out

[github.com/spacejam/sled](https://github.com/spacejam/sled) — looked promising historically (pure Rust, lock-free), but is now stale: latest release `0.34.7` is from **September 2021**, and the README itself states:

> "if reliability is your primary constraint, use SQLite. sled is beta."

and separately calls the on-disk format unstable pre-1.0, requiring manual migrations across versions. The intended successor ("komora") isn't released. Not a real candidate today regardless of benchmark numbers.

### rocksdb / LMDB (heed) — ruled out for this use case

Both are legitimate, fast embedded stores, but both pull in a C/C++ build dependency (RocksDB is a large C++ codebase; LMDB via the `heed` crate links the C `liblmdb`), which works against "tiny," and both are designed for write-heavy, large-dataset workloads (rocksdb: LSM-tree, built for far larger data volumes than a chat history file) that this workload doesn't need. redb explicitly benchmarks ahead of both for the individual-write pattern that matters here, while staying pure Rust.

## Recommendation

**redb**, directly, with a schema shaped like:

```rust
// One table per logical entity stream, keyed for free range scans:
//   key:   (entity_id: String, seq: u64)   — composite, ordered
//   value: serialized ChatMessage (bincode or serde_json bytes)
const MESSAGES: TableDefinition<(&str, u64), &[u8]> = TableDefinition::new("messages");

// Session-level metadata (one row per plan/chat/research entity):
//   key:   entity_id
//   value: { last_seq, created_at, last_accessed_at, message_count }
const SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("sessions");
```

This is the direct Rust analogue of Odysseus's two-table `sessions`/`chat_messages` split (`core/database.py:108,187`), minus the SQL — `(entity_id, seq)` as the composite key gives you Odysseus's `ORDER BY timestamp` for free via redb's native key ordering, no separate index needed. One `redb::Database` file in the app data dir (same place `bonsai_config.json`/`settings.json` already live), opened once at startup and stored in `AppState` behind whatever locking redb's own concurrency model requires (it permits concurrent readers + one writer without external locking, so likely just an `Arc<redb::Database>`, no extra `Mutex` wrapper needed beyond what redb already does internally).

Reach for **rusqlite** instead only if full-text search across all chat history becomes an actual near-term feature request — that's the one capability gap redb can't close without you building it by hand.

Sources:
- [redb (GitHub)](https://github.com/cberner/redb)
- [native_db (GitHub)](https://github.com/vincent-herlemont/native_db)
- [native_db benchmarks README](https://github.com/vincent-herlemont/native_db/blob/main/benches/README.md)
- [sled (GitHub)](https://github.com/spacejam/sled)
- [rusqlite (docs.rs)](https://docs.rs/rusqlite/)
- [Native DB Release 0.8.0 benchmarks discussion — Rust forum](https://users.rust-lang.org/t/native-db-release-0-8-0-benchmarks-vs-sqlite-redb-query-type-checking-other-features-and-significant-fixes/119623)
