// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.Azure.Functions.Worker;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The Functions host resolves HTTP routes first-match, in function-name order, not by literal precedence.
    /// So whenever one function's route also accepts paths meant for another function, the more specific function
    /// has to sort first, or its endpoint is unreachable. This checks every pair of routes in the assembly, the way
    /// 'custom-tab-markup' has always relied on and 'input-events/...' was first bitten by.
    /// </summary>
    [TestClass]
    public class RouteTests
    {
        [TestMethod]
        public void NoHttpRouteIsShadowedByAnotherFunction()
        {
            // Arrange

            var routes = typeof(DfmSettings).Assembly.DefinedTypes
                .SelectMany(t => t.GetMethods())
                .Where(m => m.GetCustomAttribute<FunctionAttribute>() != null)
                .Select(m => (m.Name, Trigger: m.GetParameters().Select(p => p.GetCustomAttribute<HttpTriggerAttribute>()).FirstOrDefault(a => a != null)))
                .Where(r => r.Trigger != null)
                .Select(r => (r.Name, r.Trigger.Methods, Template: r.Trigger.Route))
                .ToList();

            Assert.IsTrue(routes.Count > 10, "DfMon's HTTP functions should have been found");

            // Act

            var problems = new List<string>();

            foreach (var specific in routes)
            {
                foreach (var generic in routes)
                {
                    if (specific.Name == generic.Name || !specific.Methods.Intersect(generic.Methods, StringComparer.OrdinalIgnoreCase).Any())
                    {
                        continue;
                    }

                    // Does the 'generic' route accept the paths meant for the 'specific' one?
                    if (!Matches(generic.Template, SamplePath(specific.Template)))
                    {
                        continue;
                    }

                    if (Matches(specific.Template, SamplePath(generic.Template)))
                    {
                        // Both accept each other's paths, so neither is more specific. Report each pair once.
                        if (string.CompareOrdinal(specific.Name, generic.Name) < 0)
                        {
                            problems.Add($"{specific.Name} ('{specific.Template}') and {generic.Name} ('{generic.Template}') accept the same paths");
                        }
                    }
                    else if (string.Compare(specific.Name, generic.Name, StringComparison.OrdinalIgnoreCase) > 0)
                    {
                        problems.Add($"{specific.Name} ('{specific.Template}') is unreachable: the host registers {generic.Name} ('{generic.Template}') first, and it accepts the same paths");
                    }
                }
            }

            // Assert

            Assert.AreEqual(0, problems.Count, string.Join(Environment.NewLine, problems));
        }

        [TestMethod]
        [DataRow("a/b('{id}')/{action?}", "a/b('x')/replay", true)]
        [DataRow("a/b('{id}')/{action?}", "a/b('x')", true)]
        [DataRow("a/b('{id}')/{action?}", "a/b('x')/input-events/replay", false)]
        [DataRow("a/b('{id}')/tab('{t}')", "a/b('x')/tab('y')", true)]
        [DataRow("a/b('{id}')/tab('{t}')", "a/b('x')/replay", false)]
        [DataRow("a/{p1?}/{p2?}", "a", true)]
        [DataRow("a/{p1?}/{p2?}", "a/x/y/z", false)]
        [DataRow("a/{c}-{h}/b", "a/conn-hub/b", true)]
        [DataRow("a/b", "A/B", true)]
        [DataRow("a/b", "a", false)]
        public void MatchesPathsTheWayTheHostDoes(string template, string path, bool expected)
        {
            Assert.AreEqual(expected, Matches(template, path));
        }

        // A path the template accepts, with every parameter (optional ones included) filled in
        private static string SamplePath(string template)
        {
            return Regex.Replace(template, @"\{[^}]+\}", "sample");
        }

        // Whether a route template accepts a path: literal segments compare case-insensitively, a parameter segment
        // takes any value, an optional parameter may be absent at the end, and a segment mixing literals and
        // parameters (like "id('{id}')" or "{conn}-{hub}") is matched as a pattern
        private static bool Matches(string template, string path)
        {
            string[] templateSegments = template.Split('/');
            string[] pathSegments = path.Split('/');

            if (pathSegments.Length > templateSegments.Length)
            {
                return false;
            }

            for (int i = 0; i < templateSegments.Length; i++)
            {
                string segment = templateSegments[i];

                if (i >= pathSegments.Length)
                {
                    bool optional = Regex.IsMatch(segment, @"^\{[^}]+\?\}$");
                    if (optional)
                    {
                        continue;
                    }

                    return false;
                }

                string pattern = "^" + Regex.Replace(Regex.Escape(segment), @"\\\{[^}]+\}", "[^/]+") + "$";
                if (!Regex.IsMatch(pathSegments[i], pattern, RegexOptions.IgnoreCase))
                {
                    return false;
                }
            }

            return true;
        }
    }
}
