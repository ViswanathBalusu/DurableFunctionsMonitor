// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Small routines for reading source code as text. The function graph is built without compiling anything,
// so this is all the 'parsing' there is: regular expressions, and bracket counting where they give up.

// Makes a string match itself inside a regular expression. Function, activity and event names end up in
// patterns, and a name like 'My.Function' or 'orders-v2' must not be read as a pattern of its own.
export function escapeRegExp(text: string): string {

    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The (1-based) number of the line a position is on. Zero when there is no code.
export function posToLineNr(code: string | undefined, pos: number): number {

    if (!code) {
        return 0;
    }

    const end = Math.min(pos, code.length);
    let lineNr = 1;

    for (let i = 0; i < end; i++) {

        const ch = code.charCodeAt(i);

        if (ch === 10 /* \n */) {

            lineNr++;

        } else if (ch === 13 /* \r */) {

            lineNr++;

            // \r\n is one line break, when both halves of it are before the position
            if (i + 1 < end && code.charCodeAt(i + 1) === 10) {
                i++;
            }
        }
    }

    return lineNr;
}

// The last segment of a dotted name: 'Constants.Names.MyFunc' -> 'MyFunc'
export function removeNamespace(name: string): string {

    if (!name) {
        return name;
    }

    const dotPos = name.lastIndexOf('.');
    if (dotPos >= 0) {
        name = name.substring(dotPos + 1);
    }

    return name.trim();
}

const nameofRegex = /nameof\s*\(\s*([\w.]+)\s*\)/;

// Turns what stands between the brackets of [Function(...)] into a function name:
// "MyFunc" -> MyFunc, nameof(MyClass.MyFunc) -> MyFunc, Constants.MyFunc -> MyFunc
export function cleanupFunctionName(name: string): string {

    if (!name) {
        return name;
    }

    const nameofMatch = nameofRegex.exec(name);
    if (nameofMatch) {
        return removeNamespace(nameofMatch[1]);
    }

    name = name.trim();

    if (name.startsWith('"')) {
        return name.replace(/^"/, '').replace(/"$/, '');
    }

    return removeNamespace(name);
}

export type CodeInBrackets = {
    // Everything from 'startFrom' to the closing bracket (inclusive). Empty when no block was found.
    code: string;
    // Where the opening bracket of that block is, relative to 'startFrom'. -1 when no block was found.
    openBracketPos: number;
};

// Finds the end of a block of code, counting nested brackets, which is the thing regular expressions cannot do.
//
// The block is the first top-level bracket pair, from 'startFrom' on, that has one of 'mustHaveSymbols' inside it
// (or just the first one, when no symbols are given). That is what tells a method body, which spans lines, from
// the braces of a route template or of an attribute argument on the way to it:
//
//     [Function("Foo")]
//     public static void Run([HttpTrigger("get", Route = "items/{id}")] HttpRequestData req)
//     {                                                         <- '{id}' has no line break in it, so this is the block
//         ...
//     }
export function getCodeInBrackets(str: string, startFrom: number, openingBracket: string, closingBracket: string, mustHaveSymbols: string = ''): CodeInBrackets {

    let bracketCount = 0;
    let openBracketPos = -1;
    let mustHaveSymbolFound = !mustHaveSymbols;

    for (let i = startFrom; i < str.length; i++) {

        const ch = str[i];

        if (ch === openingBracket) {

            if (bracketCount <= 0) {
                openBracketPos = i;
            }
            bracketCount++;

        } else if (ch === closingBracket) {

            bracketCount--;
            if (bracketCount <= 0 && mustHaveSymbolFound) {
                return { code: str.substring(startFrom, i + 1), openBracketPos: openBracketPos - startFrom };
            }
        }

        if (bracketCount > 0 && mustHaveSymbols.includes(ch)) {
            mustHaveSymbolFound = true;
        }
    }

    return { code: '', openBracketPos: -1 };
}
