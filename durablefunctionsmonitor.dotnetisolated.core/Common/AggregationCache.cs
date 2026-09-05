// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Collections.Concurrent;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// In-memory cache for the aggregation endpoints (/stats, /failures, /children, /storage, ...).
    /// Implements decision D10 of the Svelte rewrite plan: results are cached (30s by default; the TTL
    /// is a parameter here, callers source it from settings) per hub and per normalized query, with
    /// in-flight de-duplication, so that auto-refreshing clients and several simultaneous users never
    /// trigger concurrent full-hub scans against the same Task Hub.
    /// </summary>
    internal static class AggregationCache
    {
        // Every Nth call sweeps out expired entries, so the dictionary doesn't grow unboundedly with
        // hub/query combinations that were requested once and never again.
        private const int SweepInterval = 100;

        private static readonly ConcurrentDictionary<string, CacheEntry> Entries = new();
        private static int callCount;

        /// <summary>
        /// Overridable clock, so unit tests can simulate the passage of time (TTL expiry) without
        /// actually waiting. Defaults to the real wall clock.
        /// </summary>
        internal static Func<DateTime> UtcNow = () => DateTime.UtcNow;

        /// <summary>
        /// Returns the cached result for <paramref name="key"/>, if it is still within <paramref name="ttl"/>
        /// of when it was produced. Otherwise runs <paramref name="factory"/> and caches its result.
        /// Concurrent callers with the same key, whether the entry is missing or expired, share a single
        /// invocation of <paramref name="factory"/>: the stored value is the (possibly still running)
        /// <see cref="Task{T}"/> itself, not its completed result. A factory that faults evicts its entry
        /// immediately, so the key is not poisoned for the rest of the TTL window.
        /// </summary>
        public static async Task<T> GetOrAddAsync<T>(string key, TimeSpan ttl, Func<Task<T>> factory)
        {
            SweepExpiredEntriesPeriodically();

            var now = UtcNow();

            // The Lazy<Task<T>> defers invoking the factory until its .Value is read. Wrapping it this
            // way (rather than calling factory() up front) is what makes de-duplication exact: several
            // threads may each build their own candidate CacheEntry here, but ConcurrentDictionary
            // guarantees only one of them is ever actually stored for a given key, and only the stored
            // one's Lazy is ever read - so factory() runs exactly once, no matter how many threads race.
            var candidate = new CacheEntry(
                new Lazy<Task<T>>(factory, LazyThreadSafetyMode.ExecutionAndPublication),
                now.Add(ttl));

            var entry = Entries.AddOrUpdate(
                key,
                candidate,
                (_, existing) => existing.ExpiresAtUtc > now ? existing : candidate);

            var lazyTask = (Lazy<Task<T>>)entry.LazyTask;

            try
            {
                return await lazyTask.Value.ConfigureAwait(false);
            }
            catch
            {
                // Evict this exact entry (not whatever is there now - a newer one might already have
                // replaced it) so a faulted factory does not poison the key for the rest of the TTL.
                // TryRemove(KeyValuePair<,>) only removes when the current value still equals entry
                // (reference equality, CacheEntry has no custom Equals), so a concurrent, unrelated
                // update to the same key is never clobbered.
                Entries.TryRemove(new KeyValuePair<string, CacheEntry>(key, entry));
                throw;
            }
        }

        private static void SweepExpiredEntriesPeriodically()
        {
            if (Interlocked.Increment(ref callCount) % SweepInterval != 0)
            {
                return;
            }

            var now = UtcNow();
            foreach (var kvp in Entries)
            {
                if (kvp.Value.ExpiresAtUtc <= now)
                {
                    Entries.TryRemove(kvp);
                }
            }
        }

        private sealed class CacheEntry
        {
            // A Lazy<Task<T>> for whichever T the caller asked for. Boxed as object because a single
            // dictionary is shared by every aggregation endpoint, each with its own result type; callers
            // only ever read back an entry under a key they built themselves (the key includes the
            // endpoint name), so the cast back to Lazy<Task<T>> in GetOrAddAsync always matches.
            public object LazyTask { get; }

            public DateTime ExpiresAtUtc { get; }

            public CacheEntry(object lazyTask, DateTime expiresAtUtc)
            {
                this.LazyTask = lazyTask;
                this.ExpiresAtUtc = expiresAtUtc;
            }
        }
    }
}
