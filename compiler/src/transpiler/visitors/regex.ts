const t: any = require('@babel/types');
import { checkRegExpSafety } from '../helpers';

export function handleRegexCall(
    obj: any,
    name: string,
    node: any,
    warnings: any[]
): any {
    if (t.isRegExpLiteral(obj)) {
        const pat = obj.pattern;
        checkRegExpSafety(pat, node.loc ? node.loc.start.line : 0, warnings);
        if (name === 'test') {
            return t.callExpression(t.identifier("RegExTest"), [t.stringLiteral(pat), node.arguments[0]]);
        } else if (name === 'exec') {
            return t.callExpression(t.identifier("RegExMatch"), [t.stringLiteral(pat), node.arguments[0]]);
        }
    }
    return null;
}
