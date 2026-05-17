import re

with open('crates/vm-core/src/vm.rs', 'r') as f:
    content = f.read()

# Fix push
content = re.sub(r'self\.stack\.push\((.*?)\);', r'self.stack.push(\1)?;', content)

# Fix window().unwrap()
perf_logic = """
            let global = js_sys::global();
            use wasm_bindgen::JsCast;
            let perf = global.dyn_into::<web_sys::Window>()
                .map(|w| w.performance().unwrap())
                .or_else(|global| global.dyn_into::<web_sys::WorkerGlobalScope>().map(|w| w.performance().unwrap()))
                .ok();
            let start = perf.as_ref().map(|p| p.now()).unwrap_or_else(|| js_sys::Date::now());
"""
content = re.sub(r'let start = web_sys::window\(\)\.unwrap\(\)\.performance\(\)\.unwrap\(\)\.now\(\);', perf_logic.strip(), content)

elapsed_logic = """
            let elapsed = perf.as_ref().map(|p| p.now()).unwrap_or_else(|| js_sys::Date::now()) - start;
"""
content = re.sub(r'let elapsed = web_sys::window\(\)\.unwrap\(\)\.performance\(\)\.unwrap\(\)\.now\(\) - start;', elapsed_logic.strip(), content)

# Fix frame depth limit
frame_limit = """
                    if self.frames.len() >= 64 {
                        return Err(VmError::CallStackOverflow);
                    }
                    self.frames.push(CallFrame {
"""
content = content.replace("self.frames.push(CallFrame {", frame_limit.lstrip())

with open('crates/vm-core/src/vm.rs', 'w') as f:
    f.write(content)
