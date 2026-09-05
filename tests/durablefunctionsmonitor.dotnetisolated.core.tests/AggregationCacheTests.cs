// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Threading;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// AggregationCache implements decision D10: every aggregation endpoint (/stats, /failures,
    /// /children, /storage, ...) shares one in-memory cache, per hub and normalized query, with
    /// in-flight de-duplication, so auto-refreshing clients never cause concurrent full-hub scans.
    /// Each test uses its own Guid-based key: the cache is a static dictionary shared by the whole
    /// process, and other test classes may exercise it concurrently.
    /// </summary>
    [TestClass]
    public class AggregationCacheTests
    {
        [TestCleanup]
        public void TestCleanup()
        {
            // The clock is a static, process-wide hook: always put the real one back.
            AggregationCache.UtcNow = () => DateTime.UtcNow;
        }

        [TestMethod]
        public async Task ConcurrentCallsWithTheSameKeyShareASingleFactoryInvocation()
        {
            string key = Guid.NewGuid().ToString();
            int invocationCount = 0;
            var tcs = new TaskCompletionSource<int>();

            Task<int> Factory()
            {
                Interlocked.Increment(ref invocationCount);
                return tcs.Task;
            }

            // Two callers race for the same key before the factory has produced anything.
            Task<int> task1 = AggregationCache.GetOrAddAsync(key, TimeSpan.FromSeconds(30), Factory);
            Task<int> task2 = AggregationCache.GetOrAddAsync(key, TimeSpan.FromSeconds(30), Factory);

            Assert.AreEqual(1, invocationCount, "the factory must run exactly once for concurrent callers");
            Assert.IsFalse(task1.IsCompleted);
            Assert.IsFalse(task2.IsCompleted);

            tcs.SetResult(42);

            Assert.AreEqual(42, await task1);
            Assert.AreEqual(42, await task2);
            Assert.AreEqual(1, invocationCount, "completing the shared task must not trigger a second run");
        }

        [TestMethod]
        public async Task EntryIsReusedUntilTheTtlExpiresThenTheFactoryRunsAgain()
        {
            string key = Guid.NewGuid().ToString();
            int invocationCount = 0;
            var now = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            AggregationCache.UtcNow = () => now;

            Task<int> Factory()
            {
                Interlocked.Increment(ref invocationCount);
                return Task.FromResult(invocationCount);
            }

            int first = await AggregationCache.GetOrAddAsync(key, TimeSpan.FromSeconds(30), Factory);
            int second = await AggregationCache.GetOrAddAsync(key, TimeSpan.FromSeconds(30), Factory);

            Assert.AreEqual(1, first);
            Assert.AreEqual(1, second, "still inside the TTL: must be served from the cache");
            Assert.AreEqual(1, invocationCount);

            // Advance the injected clock past the TTL - no real waiting.
            now = now.AddSeconds(31);

            int third = await AggregationCache.GetOrAddAsync(key, TimeSpan.FromSeconds(30), Factory);

            Assert.AreEqual(2, third, "past the TTL: the factory must run again");
            Assert.AreEqual(2, invocationCount);
        }

        [TestMethod]
        public async Task AFaultingFactoryDoesNotPoisonTheKey()
        {
            string key = Guid.NewGuid().ToString();
            int invocationCount = 0;

            Task<int> ThrowingFactory()
            {
                Interlocked.Increment(ref invocationCount);
                return Task.FromException<int>(new InvalidOperationException("boom"));
            }

            await Assert.ThrowsExactlyAsync<InvalidOperationException>(
                () => AggregationCache.GetOrAddAsync(key, TimeSpan.FromSeconds(30), ThrowingFactory));

            Assert.AreEqual(1, invocationCount);

            // Same key, still well inside the TTL that would have applied to the faulted entry: a
            // healthy factory must run (not throw a cached exception, not have been evicted twice).
            Task<int> SucceedingFactory()
            {
                Interlocked.Increment(ref invocationCount);
                return Task.FromResult(99);
            }

            int result = await AggregationCache.GetOrAddAsync(key, TimeSpan.FromSeconds(30), SucceedingFactory);

            Assert.AreEqual(99, result);
            Assert.AreEqual(2, invocationCount, "the faulted entry must have been evicted, not cached");
        }
    }
}
