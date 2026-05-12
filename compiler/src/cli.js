import * as fs from 'fs';
import { Parser } from './parser';
import { CodeGenerator } from './codegen';
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: npx fortress-compile <source.fvm>');
        process.exit(1);
    }
    const sourceFile = args[0];
    const sourceCode = fs.readFileSync(sourceFile, 'utf8');
    const parser = new Parser(sourceCode);
    const ast = parser.parseProgram();
    const codegen = new CodeGenerator();
    const { code, constants } = codegen.generate(ast);
    const outBase = sourceFile.replace(/\.fvm$/, '');
    fs.writeFileSync(`${outBase}.fvbc`, Buffer.from(code));
    fs.writeFileSync(`${outBase}.const.json`, constants);
    console.log(`Successfully compiled to ${outBase}.fvbc and ${outBase}.const.json`);
}
main();
//# sourceMappingURL=cli.js.map