// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// FailureSignature.Extract/Normalize/GroupKey decide how failed instances group on the Failures screen (B3).
    /// Pure logic, so every rule is exercised here rather than through the /failures endpoint.
    /// </summary>
    [TestClass]
    public class FailureSignatureTests
    {
        #region Normalize - the three mockup examples (docs/plans/svelte-rewrite/B3-failures-and-batch.md, ScreenFailures.dc.html)

        [TestMethod]
        public void Normalize_InventoryExample_ReplacesSkuAndUnitsAndWarehouseNumbers()
        {
            string result = FailureSignature.Normalize("InventoryUnavailable: SKU-4471 has 0 units in warehouse-07");

            Assert.AreEqual("InventoryUnavailable: SKU-* has * units in warehouse-*", result);
        }

        [TestMethod]
        public void Normalize_TimeoutExample_ReplacesDurationNumber()
        {
            string result = FailureSignature.Normalize("Timeout: ChargePayment did not complete within 20 s");

            Assert.AreEqual("Timeout: ChargePayment did not complete within * s", result);
        }

        [TestMethod]
        public void Normalize_LedgerExample_ReplacesQuotedAccountAndHexChecksums()
        {
            // The plan doc shows the two checksums abbreviated with an ellipsis ("8f3a…", "91c0…") for
            // readability; a real checksum is a full-length hex string, so this test uses one, which is what
            // exercises the >= 8 char hex-run rule the shortened doc text can't (only 4 hex chars survive
            // there, below the threshold).
            string result = FailureSignature.Normalize(
                "Ledger checksum mismatch for account \"4471-EU\": expected 8f3a1c9d4e2b7f60, got 91c0a2b3c4d5e6f7");

            Assert.AreEqual("Ledger checksum mismatch for account *: expected *, got *", result);
        }

        #endregion

        #region Normalize - individual rules

        [TestMethod]
        public void Normalize_Guid_IsReplaced()
        {
            string result = FailureSignature.Normalize("Duplicate id 3fa85f64-5717-4562-b3fc-2c963f66afa6 detected");

            Assert.AreEqual("Duplicate id * detected", result);
        }

        [TestMethod]
        public void Normalize_Decimal_IsReplacedAsOneToken()
        {
            string result = FailureSignature.Normalize("Amount 12.50 exceeds limit 100.00");

            Assert.AreEqual("Amount * exceeds limit *", result);
        }

        [TestMethod]
        public void Normalize_SingleQuotedValue_IsReplaced()
        {
            string result = FailureSignature.Normalize("Value 'abc-def' is invalid");

            Assert.AreEqual("Value * is invalid", result);
        }

        [TestMethod]
        public void Normalize_DoubleQuotedValue_IsReplaced()
        {
            string result = FailureSignature.Normalize("User \"john.doe\" not authorized");

            Assert.AreEqual("User * not authorized", result);
        }

        [TestMethod]
        public void Normalize_LongHexRun_IsReplaced()
        {
            string result = FailureSignature.Normalize("Checksum ABCDEF1234567890 mismatch");

            Assert.AreEqual("Checksum * mismatch", result);
        }

        [TestMethod]
        public void Normalize_ShortHexRun_IsLeftAlone()
        {
            // Below the >= 8 char threshold and not bounded by a separator that would make it a "number", so
            // it is not a signature-worthy volatile token.
            string result = FailureSignature.Normalize("Checksum ab12 mismatch");

            Assert.AreEqual("Checksum ab12 mismatch", result);
        }

        [TestMethod]
        public void Normalize_RepeatedStars_Collapse()
        {
            // Two numbers inside adjacent quoted values, with nothing between the quotes, produce two
            // back-to-back "*" once each quoted value is collapsed; the repeated-star rule then merges them.
            string result = FailureSignature.Normalize("Values \"12\"\"34\" mismatch");

            Assert.AreEqual("Values * mismatch", result);
        }

        [TestMethod]
        public void Normalize_Whitespace_Collapses()
        {
            string result = FailureSignature.Normalize("Line one\n\nLine   two");

            Assert.AreEqual("Line one Line two", result);
        }

        [TestMethod]
        public void Normalize_Empty_ReturnsNoMessage()
        {
            Assert.AreEqual("(no message)", FailureSignature.Normalize(""));
        }

        [TestMethod]
        public void Normalize_Null_ReturnsNoMessage()
        {
            Assert.AreEqual("(no message)", FailureSignature.Normalize(null));
        }

        [TestMethod]
        public void Normalize_WhitespaceOnly_ReturnsNoMessage()
        {
            Assert.AreEqual("(no message)", FailureSignature.Normalize("   "));
        }

        #endregion

        #region Extract

        [TestMethod]
        public void Extract_JsonObjectWithErrorMessage_UsesIt()
        {
            string result = FailureSignature.Extract("{\"ErrorMessage\":\"Boom failed\",\"StackTrace\":\"at Foo()\"}");

            Assert.AreEqual("Boom failed", result);
        }

        [TestMethod]
        public void Extract_JsonObjectWithErrorMessage_IsCaseInsensitive()
        {
            string result = FailureSignature.Extract("{\"errormessage\":\"lowercase key works\"}");

            Assert.AreEqual("lowercase key works", result);
        }

        [TestMethod]
        public void Extract_JsonObjectWithMessage_UsesItWhenNoErrorMessage()
        {
            string result = FailureSignature.Extract("{\"message\":\"Something broke\"}");

            Assert.AreEqual("Something broke", result);
        }

        [TestMethod]
        public void Extract_InnerFailureErrorMessage_UsedWhenOuterIsEmpty()
        {
            string result = FailureSignature.Extract("{\"ErrorMessage\":\"\",\"InnerFailure\":{\"ErrorMessage\":\"Inner boom\"}}");

            Assert.AreEqual("Inner boom", result);
        }

        [TestMethod]
        public void Extract_JsonObjectWithoutRecognisedProperty_FallsBackToRawText()
        {
            string result = FailureSignature.Extract("{\"foo\":\"bar\"}");

            Assert.AreEqual("{\"foo\":\"bar\"}", result);
        }

        [TestMethod]
        public void Extract_JsonString_IsUnwrapped()
        {
            string result = FailureSignature.Extract("\"Some error message\"");

            Assert.AreEqual("Some error message", result);
        }

        [TestMethod]
        public void Extract_PlainText_IsUsedAsIs()
        {
            string result = FailureSignature.Extract("Some error: boom");

            Assert.AreEqual("Some error: boom", result);
        }

        [TestMethod]
        public void Extract_TakesFirstLineOnly()
        {
            string result = FailureSignature.Extract("Some error: boom\nStack trace line 2\nline 3");

            Assert.AreEqual("Some error: boom", result);
        }

        [TestMethod]
        public void Extract_CapsAt300Characters()
        {
            string longLine = new string('x', 400);

            string result = FailureSignature.Extract(longLine);

            Assert.AreEqual(300, result.Length);
            Assert.AreEqual(new string('x', 300), result);
        }

        [TestMethod]
        public void Extract_EmptyOutput_ReturnsEmpty()
        {
            Assert.AreEqual(string.Empty, FailureSignature.Extract(""));
        }

        [TestMethod]
        public void Extract_NullOutput_ReturnsEmpty()
        {
            Assert.AreEqual(string.Empty, FailureSignature.Extract(null));
        }

        #endregion

        #region GroupKey

        [TestMethod]
        public void GroupKey_CombinesNameAndSignatureWithPipe()
        {
            string result = FailureSignature.GroupKey("ProcessOrderOrchestrator", "InventoryUnavailable: SKU-*");

            Assert.AreEqual("ProcessOrderOrchestrator|InventoryUnavailable: SKU-*", result);
        }

        #endregion
    }
}
