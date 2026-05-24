export const stdlibSource = `
fn map_new() {
    let m = {};
    m.keys = [];
    m.values = [];
    m.size = 0;
    return m;
}

fn map_set(m, key, value) {
    let i = 0;
    while (i < len(m.keys)) {
        if (m.keys[i] == key) { 
            m.values[i] = value; 
            return m; 
        }
        i = i + 1;
    }
    m.keys = listPush(m.keys, key);
    m.values = listPush(m.values, value);
    m.size = m.size + 1;
    return m;
}

fn map_get(m, key) {
    let i = 0;
    while (i < len(m.keys)) {
        if (m.keys[i] == key) { 
            return m.values[i]; 
        }
        i = i + 1;
    }
    return null;
}

fn map_has(m, key) {
    let i = 0;
    while (i < len(m.keys)) {
        if (m.keys[i] == key) { 
            return true; 
        }
        i = i + 1;
    }
    return false;
}

fn map_delete(m, key) {
    let nk = []; 
    let nv = []; 
    let i = 0;
    let deleted = false;
    while (i < len(m.keys)) {
        if (m.keys[i] != key) { 
            nk = listPush(nk, m.keys[i]); 
            nv = listPush(nv, m.values[i]); 
        } else {
            deleted = true;
        }
        i = i + 1;
    }
    m.keys = nk; 
    m.values = nv; 
    m.size = len(nk);
    return m;
}

fn map_clear(m) {
    m.keys = [];
    m.values = [];
    m.size = 0;
    return m;
}

fn map_keys(m) { 
    return m.keys; 
}

fn map_values_list(m) { 
    return m.values; 
}

fn set_new() { 
    let s = {}; 
    s.values = []; 
    s.size = 0; 
    return s; 
}

fn set_add(s, value) {
    let i = 0;
    while (i < len(s.values)) {
        if (s.values[i] == value) { 
            return s; 
        }
        i = i + 1;
    }
    s.values = listPush(s.values, value);
    s.size = s.size + 1;
    return s;
}

fn set_has(s, value) {
    let i = 0;
    while (i < len(s.values)) {
        if (s.values[i] == value) { 
            return true; 
        }
        i = i + 1;
    }
    return false;
}

fn set_delete(s, value) {
    let nv = []; 
    let i = 0;
    let deleted = false;
    while (i < len(s.values)) {
        if (s.values[i] != value) { 
            nv = listPush(nv, s.values[i]); 
        } else {
            deleted = true;
        }
        i = i + 1;
    }
    s.values = nv; 
    s.size = len(nv);
    return s;
}

fn set_clear(s) {
    s.values = [];
    s.size = 0;
    return s;
}

fn set_values_list(s) { 
    return s.values; 
}

fn ReflectSet(obj, prop, val) {
    if (obj == null) {
        obj[prop] = val;
        return false;
    }
    if (obj.__elementSize != null) {
        if (TypeOf(prop) == "number") {
            let index = prop;
            if (index < 0) {
                return false;
            }
            if (index >= obj.length) {
                return false;
            }
        }
    }
    obj[prop] = val;
    if (obj.__ownKeys == null) {
        obj.__ownKeys = [];
    }
    if (obj.__ownKeys != null) {
        let i = 0;
        let found = false;
        while (i < len(obj.__ownKeys)) {
            if (obj.__ownKeys[i] == prop) { found = true; }
            i = i + 1;
        }
        if (!found) {
            obj.__ownKeys = listPush(obj.__ownKeys, prop);
        }
    }
    if (obj.__sab != null) {
        if (obj.__sab.syncing != true) {
            obj.__sab.syncing = true;
            let elementSize = obj.__elementSize;
            let index = prop;
            let uVal = val;
            if (uVal < 0) {
                uVal = uVal + 4294967296;
            }
            if (elementSize == 1) {
                let b0 = uVal - MathFloor(uVal / 256) * 256;
                obj.__sab.buffer[index] = b0;
            }
            if (elementSize == 2) {
                let b0 = uVal - MathFloor(uVal / 256) * 256;
                let v8 = MathFloor(uVal / 256);
                let b1 = v8 - MathFloor(v8 / 256) * 256;
                obj.__sab.buffer[index * 2] = b0;
                obj.__sab.buffer[index * 2 + 1] = b1;
            }
            if (elementSize == 4) {
                let b0 = uVal - MathFloor(uVal / 256) * 256;
                let v8 = MathFloor(uVal / 256);
                let b1 = v8 - MathFloor(v8 / 256) * 256;
                let v16 = MathFloor(uVal / 65536);
                let b2 = v16 - MathFloor(v16 / 256) * 256;
                let v24 = MathFloor(uVal / 16777216);
                let b3 = v24 - MathFloor(v24 / 256) * 256;
                obj.__sab.buffer[index * 4] = b0;
                obj.__sab.buffer[index * 4 + 1] = b1;
                obj.__sab.buffer[index * 4 + 2] = b2;
                obj.__sab.buffer[index * 4 + 3] = b3;
            }
            if (elementSize != 1) {
                if (elementSize != 2) {
                    if (elementSize != 4) {
                        obj.__sab.buffer[index * elementSize] = val;
                    }
                }
            }
            let vIdx = 0;
            let viewsLen = len(obj.__sab.views);
            while (vIdx < viewsLen) {
                let v = obj.__sab.views[vIdx];
                if (v != obj) {
                    let vElemSize = v.__elementSize;
                    let vLen = len(obj.__sab.buffer) / vElemSize;
                    let j = 0;
                    while (j < vLen) {
                        let packedVal = 0;
                        if (vElemSize == 1) {
                            packedVal = obj.__sab.buffer[j];
                        }
                        if (vElemSize == 2) {
                            packedVal = obj.__sab.buffer[j * 2] + (obj.__sab.buffer[j * 2 + 1] * 256);
                        }
                        if (vElemSize == 4) {
                            packedVal = obj.__sab.buffer[j * 4] + (obj.__sab.buffer[j * 4 + 1] * 256) + (obj.__sab.buffer[j * 4 + 2] * 65536) + (obj.__sab.buffer[j * 4 + 3] * 16777216);
                        }
                        if (vElemSize != 1) {
                            if (vElemSize != 2) {
                                if (vElemSize != 4) {
                                    packedVal = obj.__sab.buffer[j * vElemSize];
                                }
                            }
                        }
                        v[j] = packedVal;
                        j = j + 1;
                    }
                }
                vIdx = vIdx + 1;
            }
            obj.__sab.syncing = false;
        }
    }
    return true;
}

fn ReflectOwnKeys(obj) {
    if (obj == null) { return []; }
    if (obj.__ownKeys == null) { return []; }
    return obj.__ownKeys;
}

fn ReflectHas(obj, key) {
    if (obj == null) { return false; }
    if (obj.__ownKeys == null) { return obj[key] != null; }
    let i = 0;
    while (i < len(obj.__ownKeys)) {
        if (obj.__ownKeys[i] == key) { return true; }
        i = i + 1;
    }
    return false;
}

fn len_helper(x) {
    if (x == null) { return 0; }
    if (TypeOf(x) == "object") {
        if (x.__elementSize != null) {
            return x.length;
        }
    }
    return len(x);
}
`;
