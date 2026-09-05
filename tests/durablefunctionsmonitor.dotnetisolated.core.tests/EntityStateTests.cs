// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    [TestClass]
    public class EntityStateTests
    {
        [TestMethod]
        public void ParseReturnsNullForNullOrEmptyState()
        {
            Assert.IsNull(EntityState.Parse(null));
            Assert.IsNull(EntityState.Parse(string.Empty));
        }

        [TestMethod]
        public void ParseReturnsThePlainObjectStateAsIs()
        {
            // Arrange
            string serialized = "{\"count\":42,\"name\":\"widget\"}";

            // Act
            var state = EntityState.Parse(serialized);

            // Assert
            Assert.AreEqual(JTokenType.Object, state.Type);
            Assert.AreEqual(42, state["count"].Value<int>());
            Assert.AreEqual("widget", state["name"].Value<string>());
        }

        [TestMethod]
        public void ParseUnwrapsTheExistsStateEnvelopeWhenStateIsAJsonObjectString()
        {
            // Arrange: same envelope DetailedOrchestrationStatus.ConvertInput unwraps for an entity's Input.
            string serialized = "{\"exists\":true,\"state\":\"{\\\"count\\\":42}\"}";

            // Act
            var state = EntityState.Parse(serialized);

            // Assert
            Assert.AreEqual(JTokenType.Object, state.Type);
            Assert.IsTrue(state["exists"].Value<bool>());
            Assert.AreEqual(JTokenType.Object, state["state"].Type);
            Assert.AreEqual(42, state["state"]["count"].Value<int>());
        }

        [TestMethod]
        public void ParseLeavesANonObjectShapedStateStringAlone()
        {
            // Arrange: "state" is a string, but it does not look like a serialized JSON object
            // (does not start/end with braces), so it must stay untouched.
            string serialized = "{\"exists\":true,\"state\":\"just some text\"}";

            // Act
            var state = EntityState.Parse(serialized);

            // Assert
            Assert.AreEqual(JTokenType.String, state["state"].Type);
            Assert.AreEqual("just some text", state["state"].Value<string>());
        }

        [TestMethod]
        public void ParseLeavesTheInnerStateStringAloneWhenItIsMalformedJson()
        {
            // Arrange: "state" looks object-shaped (starts/ends with braces) but is not valid JSON.
            string serialized = "{\"exists\":true,\"state\":\"{not valid json}\"}";

            // Act
            var state = EntityState.Parse(serialized);

            // Assert: outer object still parses fine; the inner value is left as the raw string.
            Assert.AreEqual(JTokenType.Object, state.Type);
            Assert.AreEqual(JTokenType.String, state["state"].Type);
            Assert.AreEqual("{not valid json}", state["state"].Value<string>());
        }

        [TestMethod]
        public void ParseReturnsAPlainStringTokenForMalformedTopLevelJsonInsteadOfThrowing()
        {
            // Arrange
            string serialized = "{this is not json at all";

            // Act
            var state = EntityState.Parse(serialized);

            // Assert
            Assert.AreEqual(JTokenType.String, state.Type);
            Assert.AreEqual(serialized, state.Value<string>());
        }

        [TestMethod]
        public void ParseReturnsNonObjectTokensUnchanged()
        {
            // A durable entity's state can be any JSON value, not just an object.
            Assert.AreEqual(123, EntityState.Parse("123").Value<int>());
            Assert.AreEqual("hello", EntityState.Parse("\"hello\"").Value<string>());
            Assert.AreEqual(JTokenType.Array, EntityState.Parse("[1,2,3]").Type);
        }

        [TestMethod]
        public void SummarizeReturnsNullWhenThereIsNoState()
        {
            Assert.IsNull(EntityState.Summarize(null));
        }

        [TestMethod]
        public void SummarizeRendersCompactSingleLineJson()
        {
            // Arrange
            var state = JObject.Parse("{\"count\":42,\"name\":\"widget\"}");

            // Act
            string summary = EntityState.Summarize(state);

            // Assert
            Assert.AreEqual("{\"count\":42,\"name\":\"widget\"}", summary);
            Assert.IsFalse(summary.Contains('\n') || summary.Contains('\r'));
        }

        [TestMethod]
        public void SummarizeTruncatesLongJsonToTheMaxLengthWithATrailingEllipsis()
        {
            // Arrange: an object whose compact JSON is well over the 120-character cap.
            var state = new JObject { ["text"] = new string('a', 300) };

            // Act
            string summary = EntityState.Summarize(state);

            // Assert
            Assert.AreEqual(EntityState.MaxSummaryLength, summary.Length);
            Assert.AreEqual('…', summary[summary.Length - 1]);
            string fullJson = state.ToString(Newtonsoft.Json.Formatting.None);
            Assert.AreEqual(fullJson.Substring(0, EntityState.MaxSummaryLength - 1), summary.Substring(0, EntityState.MaxSummaryLength - 1));
        }

        [TestMethod]
        public void SummarizeDoesNotTruncateJsonAtOrUnderTheMaxLength()
        {
            // Arrange: build an object whose compact JSON is exactly 120 characters.
            // {"text":"aaa...a"} - 10 characters of scaffolding ({"text":"" + "}), rest is filler.
            const string scaffold = "{\"text\":\"\"}";
            int fillerLength = EntityState.MaxSummaryLength - scaffold.Length;
            var state = new JObject { ["text"] = new string('a', fillerLength) };

            // Act
            string summary = EntityState.Summarize(state);

            // Assert
            Assert.AreEqual(EntityState.MaxSummaryLength, summary.Length);
            Assert.IsFalse(summary.EndsWith("…"));
        }
    }
}
