export const SAB_EMULATION_CODE = `
function SharedArrayBuffer_new(size) {
    let arr = [];
    let i = 0;
    while (i < size) {
        arr = listPush(arr, 0);
        i = i + 1;
    }
    return { __is_sab: true, buffer: arr, views: [] };
}
function TypedArray_new(arg, elementSize) {
    let view = {};
    view.__elementSize = elementSize;
    view.__ownKeys = ["length", "__elementSize"];
    
    if (TypeOf(arg) == "number") {
        view.length = arg;
        let i = 0;
        while (i < arg) {
            view[i] = 0;
            view.__ownKeys = listPush(view.__ownKeys, i);
            i = i + 1;
        }
        return view;
    }
    
    if (TypeOf(arg) == "object") {
        if (arg != null) {
            if (arg.__is_sab) {
                view.__sab = arg;
                view.__ownKeys = listPush(view.__ownKeys, "__sab");
                let byteLen = len(arg.buffer);
                let viewLen = MathFloor(byteLen / elementSize);
                view.length = viewLen;
                
                // Initialize elements from the shared buffer
                let i = 0;
                while (i < viewLen) {
                    let val = 0;
                    if (elementSize == 1) {
                        val = arg.buffer[i];
                    } else {
                        if (elementSize == 2) {
                            val = arg.buffer[i * 2] + arg.buffer[i * 2 + 1] * 256;
                        } else {
                            if (elementSize == 4) {
                                val = arg.buffer[i * 4] + arg.buffer[i * 4 + 1] * 256 + arg.buffer[i * 4 + 2] * 65536 + arg.buffer[i * 4 + 3] * 16777216;
                            } else {
                                val = arg.buffer[i * elementSize];
                            }
                        }
                    }
                    view[i] = val;
                    view.__ownKeys = listPush(view.__ownKeys, i);
                    i = i + 1;
                }
                
                // Add this view to the SharedArrayBuffer's views list
                if (arg.views == null) {
                    arg.views = [];
                }
                arg.views = listPush(arg.views, view);
                return view;
            }
        }
        
        // Copying from another object/list
        let sz = arg.length;
        if (sz == null) {
            sz = len(arg);
        }
        view.length = sz;
        let i = 0;
        while (i < sz) {
            view[i] = arg[i];
            view.__ownKeys = listPush(view.__ownKeys, i);
            i = i + 1;
        }
        return view;
    }
    
    let isArr = false;
    if (TypeOf(arg) == "array") { isArr = true; }
    if (TypeOf(arg) == "list") { isArr = true; }
    if (isArr) {
        let sz = len(arg);
        view.length = sz;
        let i = 0;
        while (i < sz) {
            view[i] = arg[i];
            view.__ownKeys = listPush(view.__ownKeys, i);
            i = i + 1;
        }
        return view;
    }
    
    view.length = 0;
    return view;
}
function Int8Array_new(arg) { return TypedArray_new(arg, 1); }
function Uint8Array_new(arg) { return TypedArray_new(arg, 1); }
function Uint8ClampedArray_new(arg) { return TypedArray_new(arg, 1); }
function Int16Array_new(arg) { return TypedArray_new(arg, 2); }
function Uint16Array_new(arg) { return TypedArray_new(arg, 2); }
function Int32Array_new(arg) { return TypedArray_new(arg, 4); }
function Uint32Array_new(arg) { return TypedArray_new(arg, 4); }
function Float32Array_new(arg) { return TypedArray_new(arg, 4); }
function Float64Array_new(arg) { return TypedArray_new(arg, 8); }
`;
