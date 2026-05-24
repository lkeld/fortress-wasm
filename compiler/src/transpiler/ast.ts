const parser: any = require('@babel/parser');
const generate: any = require('@babel/generator').default;

export function parseCode(code: string) {
    return parser.parse(code, {
        sourceType: 'module',
        plugins: [
            'typescript',
            'decorators-legacy',
            'classProperties',
            'classPrivateProperties',
            'classPrivateMethods',
        ]
    });
}

export function generateCode(ast: any, options: any = {}) {
    return generate(ast, options);
}
