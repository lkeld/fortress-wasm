const t: any = require('@babel/types');
import { checkRegExpSafety } from '../helpers';

export function handleStringCall(
    obj: any,
    name: string,
    node: any,
    variableTypes: Map<string, string>,
    usedStdlibSet: Set<string>,
    warnings: any[]
): any {
    const type = t.isIdentifier(obj) ? variableTypes.get(obj.name) : null;
    
    // 1. Slice and at (String variant)
    if (name === 'slice' || name === 'at') {
        if (name === 'slice') {
            if (type === 'string') {
                return t.callExpression(t.identifier("StrSlice"), [obj, node.arguments[0], node.arguments[1] || t.nullLiteral()]);
            }
        } else {
            // at(i)
            const i = node.arguments[0];
            if (type === 'string') {
                return t.callExpression(t.identifier("StrAt"), [obj, i]);
            }
        }
        return null;
    }

    // 2. Unary string methods
    const stringUnary = ['toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd'];
    if (stringUnary.includes(name)) {
        const mapped = `Str${name.charAt(0).toUpperCase()}${name.slice(1)}`;
        return t.callExpression(t.identifier(mapped), [obj]);
    }

    // 3. Binary and other string methods
    const stringBinary = ['indexOf', 'lastIndexOf', 'split', 'repeat', 'startsWith', 'endsWith', 'includes', 'charAt', 'charCodeAt'];
    if (stringBinary.includes(name)) {
        if (name === 'charAt') {
            return t.memberExpression(obj, node.arguments[0], true);
        }
        if (name === 'split' && t.isRegExpLiteral(node.arguments[0])) {
            const pat = node.arguments[0].pattern;
            checkRegExpSafety(pat, node.loc ? node.loc.start.line : 0, warnings);
            return t.callExpression(t.identifier("RegExSplit"), [t.stringLiteral(pat), obj]);
        }
        const mapped = `Str${name.charAt(0).toUpperCase()}${name.slice(1)}`;
        return t.callExpression(t.identifier(mapped), [obj, node.arguments[0]]);
    }

    if (name === 'substring') {
        return t.callExpression(t.identifier("StrSubstring"), [obj, node.arguments[0], node.arguments[1] || t.nullLiteral()]);
    }

    if (name === 'replace' || name === 'replaceAll') {
        const arg0 = node.arguments[0];
        if (t.isRegExpLiteral(arg0)) {
            const pat = arg0.pattern;
            checkRegExpSafety(pat, node.loc ? node.loc.start.line : 0, warnings);
            return t.callExpression(t.identifier("RegExReplace"), [t.stringLiteral(pat), obj, node.arguments[1]]);
        } else {
            const mapped = name === 'replace' ? "StrReplace" : "StrReplaceAll";
            return t.callExpression(t.identifier(mapped), [obj, arg0, node.arguments[1]]);
        }
    }

    if (name === 'match') {
        const arg0 = node.arguments[0];
        if (t.isRegExpLiteral(arg0)) {
            const pat = arg0.pattern;
            checkRegExpSafety(pat, node.loc ? node.loc.start.line : 0, warnings);
            return t.callExpression(t.identifier("RegExMatch"), [t.stringLiteral(pat), obj]);
        } else {
            return t.callExpression(t.identifier("RegExMatch"), [arg0, obj]);
        }
    }

    if (name === 'padStart' || name === 'padEnd') {
        const mapped = `Str${name.charAt(0).toUpperCase()}${name.slice(1)}`;
        return t.callExpression(t.identifier(mapped), [obj, node.arguments[0], node.arguments[1] || t.stringLiteral(" ")]);
    }

    return null;
}
