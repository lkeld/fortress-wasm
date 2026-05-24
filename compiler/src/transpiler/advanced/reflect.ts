export function mapReflectCalls(callee: any, node: any, usedStdlibSet: Set<string>, t: any): any {
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.object) && callee.object.name === 'Reflect') {
        const prop = callee.property;
        if (t.isIdentifier(prop) && !callee.computed) {
            const name = prop.name;
            if (name === 'get') {
                const target = node.arguments[0];
                const key = node.arguments[1];
                return t.memberExpression(target, key, true);
            } else if (name === 'set') {
                const target = node.arguments[0];
                const key = node.arguments[1];
                const val = node.arguments[2];
                usedStdlibSet.add('ReflectSet');
                return t.callExpression(t.identifier("ReflectSet"), [target, key, val]);
            } else if (name === 'has') {
                const target = node.arguments[0];
                const key = node.arguments[1];
                usedStdlibSet.add('ReflectHas');
                return t.callExpression(t.identifier("ReflectHas"), [target, key]);
            } else if (name === 'ownKeys') {
                const target = node.arguments[0];
                usedStdlibSet.add('ReflectOwnKeys');
                return t.callExpression(t.identifier("ReflectOwnKeys"), [target]);
            }
        }
    }
    return null;
}
