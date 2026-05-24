const t: any = require('@babel/types');

export function handleMathCall(
    obj: any,
    name: string,
    node: any
): any {
    if (t.isIdentifier(obj) && obj.name === 'Math') {
        if (name === 'random') {
            return t.callExpression(t.identifier("MathRandom"), []);
        } else if (name === 'PI') {
            return t.numericLiteral(3.141592653589793);
        } else if (name === 'E') {
            return t.numericLiteral(2.718281828459045);
        } else if (name === 'hypot') {
            const args = node.arguments;
            if (args.length <= 2) {
                return t.callExpression(t.identifier("MathHypot"), args);
            } else {
                let sum: any = t.binaryExpression("*", args[0], args[0]);
                for (let i = 1; i < args.length; i++) {
                    sum = t.binaryExpression("+", sum, t.binaryExpression("*", args[i], args[i]));
                }
                return t.callExpression(t.identifier("MathSqrt"), [sum]);
            }
        } else {
            const mappedName = `Math${name.charAt(0).toUpperCase()}${name.slice(1)}`;
            return t.callExpression(t.identifier(mappedName), node.arguments);
        }
    }
    return null;
}
