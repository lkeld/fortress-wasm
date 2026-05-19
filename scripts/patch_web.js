const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'pkg-web', 'vm_core.js');

if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const search = "import { native_call } from 'env';";
    const replace = "const native_call = (arg0, arg1) => (typeof window !== 'undefined' && typeof window.native_call === 'function') ? window.native_call(arg0, arg1) : \"\";";
    
    if (content.includes(search)) {
        content = content.replace(search, replace);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log("Successfully patched pkg-web/vm_core.js");
    } else {
        console.log("No patch needed for pkg-web/vm_core.js");
    }
} else {
    console.warn(`File not found: ${filePath}`);
}
